var Evaluator = require('stylus/lib/visitor/evaluator')
  , utils = require('stylus/lib/utils')
  , loaderUtils = require('loader-utils')
  , UnresolvedImport = require('./unresolved-import');

module.exports = CachedPathEvaluator;

var _find = utils.find;
function find(options, path, paths, filename) {
  var found = _find.call(utils, path, paths, filename);
  if (found) {
    options.addDependencies(found);
  }
  return found;
}

var _lookupIndex = utils.lookupIndex;
// Custom `lookupIndex`. If the original doesn't find anything, throw an
// exception purely for flow-control, telling our outer render "loop" to
// use webpack's `resolve` on the requested file and try again.
function lookupIndex(options, name, paths, filename) {
  // `utils.lookupIndex` is recursive, so temporarily replace it with the version
  // that it expects, so our fallback doesn't kick in on the first recursive call.
  utils.lookupIndex = _lookupIndex;
  var found = _lookupIndex.call(utils, name, paths, filename);
  utils.lookupIndex = lookupIndex;
  if (!found) {
    var context = paths[paths.length - 1];
    var request = loaderUtils.urlToRequest(name, options.root);
    var contextImports = options.resolvedImports[context] || {};
    var result = contextImports[request];
    if (result) {
      found = [result];
    } else {
      throw new UnresolvedImport(context, request);
    }
  }
  if (found) {
    options.addDependencies(found);
  }
  return found;
}

function CachedPathEvaluator(root, options) {
  Evaluator.apply(this, arguments);

  this.loaderOptions = options;
}

CachedPathEvaluator.prototype = Object.create(Evaluator.prototype);
CachedPathEvaluator.prototype.constructor = CachedPathEvaluator;

var _visitImport = CachedPathEvaluator.prototype.visitImport;
CachedPathEvaluator.prototype.visitImport = function(imported) {
  // Patch up `utils.find` and `utils.lookupIndex` with our custom hook.
  utils.find = find.bind(utils, this.loaderOptions);
  utils.lookupIndex = lookupIndex.bind(utils, this.loaderOptions);
  try {
    return _visitImport.apply(this, arguments);
  } finally {
    // Replace originals in case other libraries are doing stuff with `stylus`.
    utils.find = _find;
    utils.lookupIndex = _lookupIndex;
  }
};
