'use strict';

/*
* Checks if the given error contains any kind of mongo information.
* If it does, we will mutate it so that the error ns is SQL
* */
function parseError(e) {
  let sqlError = (e.source || e);
  if (e.code && e.code.indexOf('MONGO') === 0) {
    e.ns = 'STORE.MONGO';
  }
  e.ns = 'STORE.mongo';
  switch (sqlError.name) {
    case 'ValidatorError':
      e.code = 'STORE.DATA';
      break;
    case 'VersionError':
      e.code = 'STORE.DATA_VERSION';
      break;
    default:
      e.code = 'DATABASE_ERROR';
  }
  return true;
}

module.exports = parseError;