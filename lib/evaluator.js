'use strict';
var Evaluator = require('stylus/lib/visitor/evaluator');
var utils = require('stylus/lib/utils');
var UnresolvedImport = require('./unresolved-import');

var _find = utils.find;
function find(options, path, paths, filename) {
  var found = _find.call(utils, path, paths, filename);
  if (found) {
    options.importCache.addDependencies(found);
  }
  return found;
}

var _lookupIndex = utils.lookupIndex;
// Custom `lookupIndex`. If the original doesn't find anything, throw an
// exception purely for flow-control, telling our outer render "loop" to
// use webpack's `resolve` on the requested file and try again.
function lookupIndex(options, name, paths, filename) {
  // `utils.lookupIndex` uses both `find` and `lookupIndex` (recursively), so
  // temporarily replace them with the originals.
  utils.find = _find;
  utils.lookupIndex = _lookupIndex;
  var found = _lookupIndex.call(utils, name, paths, filename);
  utils.find = find;
  utils.lookupIndex = lookupIndex;
  if (!found && name.indexOf('~') === 0) {
    var context = paths[paths.length - 1];
    var request = options.importCache.nameToRequest(name);
    var result = options.importCache.lookupImport(context, request);
    if (result) {
      found = [result];
    } else {
      throw new UnresolvedImport(context, request);
    }
  }
  if (found) {
    options.importCache.addDependencies(found);
  }
  return found;
}

function CachedPathEvaluator() {
  return Evaluator.apply(this, arguments);
}

CachedPathEvaluator.prototype = Object.create(Evaluator.prototype);
CachedPathEvaluator.prototype.constructor = CachedPathEvaluator;

CachedPathEvaluator.prototype.visitImport = function() {
  // Patch up `utils.find` and `utils.lookupIndex` with our custom hook.
  var __find = utils.find;
  var __lookupIndex = utils.lookupIndex;
  utils.find = find.bind(utils, this.options);
  utils.lookupIndex = lookupIndex.bind(utils, this.options);
  try {
    return Evaluator.prototype.visitImport.apply(this, arguments);
  } finally {
    // Replace originals in case other libraries are doing stuff with `stylus`.
    utils.find = __find;
    utils.lookupIndex = __lookupIndex;
  }
};

module.exports = CachedPathEvaluator;
