'use strict';
var dirname = require('path').dirname;
var Evaluator = require('stylus/lib/visitor/evaluator');
var utils = require('stylus/lib/utils');
var loaderUtils = require('loader-utils');
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
  // `utils.lookupIndex` is recursive, so temporarily replace it with the version
  // that it expects, so our fallback doesn't kick in on the first recursive call.
  utils.lookupIndex = _lookupIndex;
  var found = _lookupIndex.call(utils, name, paths, filename);
  utils.lookupIndex = lookupIndex;
  if (!found) {
    var context = paths[paths.length - 1];
    var request = loaderUtils.urlToRequest(name, options.root);
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

/**
 * Given an array of `nodes`, find any Import nodes that have a static webpack
 * path - that is, begins with `~` and is not an expression with things like
 * variable interpolation, etc. Add them to the import queue to be resolved
 * the next time we escape the render in progress.
 * @param {Array} nodes - An array of Stylus AST nodes.
 * @return {undefined}
 */
CachedPathEvaluator.prototype._enqueueImportNodes = function(nodes) {
  nodes.forEach(function(node) {
    if (node.constructor.name === 'Import' &&
        node.path.nodes.length === 1 &&
        node.path.first.constructor.name === 'String') {
      var pathNode = node.path.first;
      if (pathNode.val.indexOf('~') === 0) {
        var context = dirname(pathNode.filename);
        var request = loaderUtils.urlToRequest(pathNode.val, this.options.root);
        this.options.importCache.enqueueImport(context, request);
      }
    }
  }, this);
};

CachedPathEvaluator.prototype.visitRoot = function(block) {
  /* eslint-disable eqeqeq */
  // This is how Stylus itself checks (==), so duplicate that here.
  if (block == this.root) {
    this._enqueueImportNodes(block.nodes);
  }
  return Evaluator.prototype.visitRoot.apply(this, arguments);
};

CachedPathEvaluator.prototype.visitBlock = function(block) {
  this._enqueueImportNodes(block.nodes);
  return Evaluator.prototype.visitBlock.apply(this, arguments);
};

CachedPathEvaluator.prototype.visitImport = function() {
  // Patch up `utils.find` and `utils.lookupIndex` with our custom hook.
  utils.find = find.bind(utils, this.options);
  utils.lookupIndex = lookupIndex.bind(utils, this.options);
  try {
    return Evaluator.prototype.visitImport.apply(this, arguments);
  } finally {
    // Replace originals in case other libraries are doing stuff with `stylus`.
    utils.find = _find;
    utils.lookupIndex = _lookupIndex;
  }
};

module.exports = CachedPathEvaluator;
