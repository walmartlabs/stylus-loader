'use strict';

function UnresolvedImport(context, request) {
  this.name = 'UnresolvedImport';
  this.message = 'Unresolved import: (' + context + ', ' + request + ')';
  this.stack = (new Error()).stack;
  this.importContext = context;
  this.importRequest = request;
}

UnresolvedImport.prototype = Object.create(Error.prototype);
UnresolvedImport.prototype.constructor = UnresolvedImport;

module.exports = UnresolvedImport;
