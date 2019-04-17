'use strict';
const storeInit = require('./lib/mongoStore');
/**
 * The MongoDB Store wrapper handles mongo connections and model definition.
 * Models are required to be stored under "app/models"
 * An example model definition:
 * 'app/models/User.js'
 * --------------------------
 'use strict';
 module.exports = (Schema, mongoose) => {
  const schema = new Schema({
    name: String,
  });
  return schema;
};
 * --------------------------
 * 'launch.js'
 const thorin = require('thorin');
 thorin.addStore(require('thorin-store-mongo'));
 thorin.run(async (err) => {
  if (err) return thorin.exit(err);
  const store = thorin.store('mongo');
  const User = store.model('user');
  let userObj = new User({
    name: 'John'
  });
  await userObj.save();
 });
 * --------------------------
 */
module.exports = function init(thorin, opt) {
  // Attach the Mongo error parser to thorin.
  thorin.addErrorParser(require('./lib/errorParser'));
  const ThorinMongoStore = storeInit(thorin, opt);

  return ThorinMongoStore;
};
module.exports.publicName = 'mongo';
