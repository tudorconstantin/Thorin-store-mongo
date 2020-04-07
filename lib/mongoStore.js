'use strict';
const mongoose = require('mongoose'),
  fs = require('fs'),
  path = require('path');
/**
 * The main MongoStore class definition
 * */
module.exports = (thorin, opt) => {

  const config = Symbol(),
    models = Symbol(),
    loaded = Symbol(),
    initialized = Symbol(),
    modelPaths = Symbol(),
    mongo = Symbol();

  class ThorinMongoStore extends thorin.Interface.Store {

    static publicName() {
      return "mongo";
    }

    constructor() {
      super();
      this.type = 'mongo';
      this[loaded] = false;
      this[initialized] = false;
      this[config] = {};
      this[models] = {};
      this[modelPaths] = [];
      this[mongo] = null;
    }

    /**
     * Manually add model paths to the Mongo Model loader.
     * This will only work BEFORE the init() function is called.
     * */
    addModelPath(path) {
      if (typeof path !== 'string' || !path) return false;
      if (this[initialized]) {
        return this.addModel(this.loadModel(path));
      }
      this[modelPaths].push(path);
      return this;
    }

    /**
     * Adds a model definition to the store
     * */
    addModel(modelObj) {
      if (typeof modelObj !== 'function') return false;
      if (typeof modelObj.modelName !== 'string' || !modelObj.modelName) return false;
      if (this[models][modelObj.modelName]) {
        console.error(`Thorin.mongo: model ${modelObj.modelName} is already added`);
        return false;
      }
      this[models][modelObj.modelName] = modelObj;
      return this;
    }

    /**
     * Returns a single model instance by its name.
     * */
    model(name) {
      return this[models][name] || null;
    }

    getModels() {
      return this[models];
    }

    /**
     * Returns the mongoose instance
     * */
    getMongo() {
      return this[mongo];
    }

    /**
     * Loads a model definition file
     * */
    loadModel(modelPath) {
      if (!path.isAbsolute(modelPath)) {
        modelPath = path.normalize(thorin.root + '/' + modelPath);
      }
      let paths = thorin.util.isFile(modelPath) ? [modelPath] : thorin.util.readDirectory(modelPath, {
        ext: 'js'
      });
      paths.forEach((modelPath) => {
        let modelName = path.basename(modelPath).replace('.js', '');
        modelName = modelName.charAt(0).toLowerCase() + modelName.substr(1);  // capitalizeFirstCharacter as the modelName
        let modelFn;
        try {
          modelFn = require(modelPath);
        } catch (e) {
          console.error('Thorin.mongo: could not require model: [' + modelPath + ']\n', e.stack);
          return;
        }
        if (modelFn == null) return;  // we skip it
        if (typeof modelFn !== 'function') {
          console.error(`Thorin.mongo: Model: [${modelPath}] must export a function(Schema, mongoose){} and return a schema object.`);
          return;
        }
        let schemaObj = modelFn(mongoose.Schema, mongoose);
        if (typeof schemaObj !== 'object' || !schemaObj || !(schemaObj instanceof mongoose.Schema)) {
          console.error(`Thorin.mongo: Model: [${modelPath}] must return a schema object.`);
          return;
        }
        let modelObj = mongoose.model(modelName, schemaObj);
        this.addModel(modelObj);
      });
    }

    /**
     * Initializes the store with configuration
     * */
    init(storeConfig) {
      this[config] = thorin.util.extend({
        url: null,    // The Full connect URL,
        // OR
        hostname: 'localhost',
        port: 27017,
        user: null,
        password: null,
        database: null,
        // Additional settings
        path: {
          models: path.normalize(thorin.root + '/app/models')
        },
        // MongoDB additional options
        options: {
          ...storeConfig.options || {
            useUnifiedTopology: true,
            useNewUrlParser: true,
            useCreateIndex: true,
            reconnectInterval: 0, // Reconnect disabled
            poolSize: 15, // Maintain up to 15 socket connections
            // If not connected, return errors immediately rather than waiting for reconnect
            bufferMaxEntries: 0,
            connectTimeoutMS: 10000, // Give up initial connection after 10 seconds
            socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
            family: 4 // Use IPv4, skip trying IPv6
          }
        }
      }, storeConfig);
      if (!(this[config].path.models instanceof Array)) this[config].path.models = [this[config].path.models];
      this[config].path.models = this[config].path.models.concat(this[modelPaths]);
      thorin.config(`store.${this.name}`, this[config]);
      this[initialized] = true;
      this[config].path.models.forEach((modelPath) => {
        this.loadModel(modelPath);
      });
    }

    /**
     * Try to connect to mongo and boot up the store
     * */
    run(done) {
      if (this[mongo]) return done(); // already connected
      let c = this[config];
      if (!c.url) {
        if (!c.database) return done(thorin.error('MONGO.CONNECTION', 'Missing database credentials'));
        if (!c.hostname) return done(thorin.error('MONGO.CONNECTION', 'Missing hostname'))
        c.url = `mongodb://`;
        if (c.user) {
          c.url += c.user;
          if (c.password) c.url += `:${c.password}`;
          c.url += '@';
        }
        c.url += c.hostname;
        c.url += `:${c.port}`;
        c.url += `/${c.database}`;
      }
      this[mongo] = mongoose.connect(c.url, c.options, (err) => {
        if (err) return done(thorin.error('MONGO.CONNECTION', 'Could not connect to mongo', err));
        this.logger.info(`Connected to Mongo server`);
        done();
      });
    }

    /**
     * This offers mongo transaction support (called sessions - see https://mongoosejs.com/docs/transactions.html)
     * The transaction wrapper looks as following:
     * storeObj.transaction(async (session) => {
     *  // do stuff
     *  const Account = store.model('account');
     *  await Account.findOne({}).session(session);
     *  let accObj = new Account({});
     *  await accObj.save({session});
     * }).then((res) => {
     *  // transaction committed.
     * }).catch((e) => {
     *  // transaction rolled back
     * });
     * Options:
     *  opt.readConcern - the read concern level, see https://docs.mongodb.com/manual/core/transactions/#transactions-api
     *  opt.writeConcern - the write concern level, see docs
     * */
    transaction(fn, opt = {}) {
      return new Promise(async (resolve, reject) => {
        let session;
        try {
          session = await mongoose.startSession(opt);
          session.startTransaction();
        } catch (e) {
          return reject(e);
        }
        let isDone = false;
        session.commit = async function commit(res) {
          if (isDone) return;
          isDone = true;
          try {
            await session.commitTransaction();
            resolve(res);
          } catch (e) {
            reject(e);
          }
        }

        session.rollback = async function rollback(err) {
          if (isDone) return;
          isDone = true;
          try {
            await session.abortTransaction();
          } catch (e) {
          }
          reject(err);
        }

        try {
          let res = await fn(session);
          await session.commit(res);
        } catch (e) {
          await session.rollback(e);
        }
      });
    }


    get logger() {
      return thorin.logger(`store.${this.name}`);
    }

  }

  return ThorinMongoStore;
};
