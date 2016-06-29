'use strict';
var path = require('path');
var whenNodefn = require('when/node/function');
var UnresolvedImport = require('./unresolved-import');

function ImportCache(loaderContext) {
  // webpack's `resolve`, promisified.
  this.resolve = whenNodefn.lift(loaderContext.resolve).bind(loaderContext);
  this.resolveCache = {};
  this.resolveQueue = [];
  this.dependencies = {};
}

ImportCache.prototype.lookupImport = function(context, request) {
  var contextImports = this.resolveCache[context] || {};
  return contextImports[request];
};

ImportCache.prototype.cacheImport = function(context, request, result) {
  var contextImports = this.resolveCache[context] || {};
  contextImports[request] = result;
  this.resolveCache[context] = contextImports;
};

/**
 * Use webpack's `resolve` to resolve the given Stylus import, which may
 * require multiple attempts.
 * @param {String} context - Directory of the file in which the import is found.
 * @param {String} request - Path the file is attempting to import.
 * @return {Promise} Promise that will evaluate to the resolved import path,
 *                   or throw if it can't be resolved.
 */
ImportCache.prototype.resolveStylusImport = function(context, request) {
  var cached = this.lookupImport(context, request);
  if (cached) {
    return Promise.resolve(cached);
  }

  var finalRequest = request;
  var indexRequest;

  // Check if it's a CSS import.
  var literal = /\.css(?:"|$)/.test(request);

  // If it's not CSS and it doesn't end in .styl, try adding '.styl'
  // and '/index.styl'
  if (!literal && !/\.styl$/i.test(request)) {
    finalRequest += '.styl';
    indexRequest = path.join(request, 'index.styl');
  }

  var self = this;
  var resolveRequest = this.resolve(context, finalRequest);

  if (indexRequest) {
    resolveRequest = resolveRequest.catch(function() {
      finalRequest = indexRequest;
      return self.resolve(context, finalRequest);
    });
  }

  return resolveRequest.then(function(result) {
    self.cacheImport(context, request, result);
    self.cacheImport(context, finalRequest, result);
    return result;
  });
};

ImportCache.prototype.enqueueImport = function(context, request) {
  // Make sure it's not already resolved.
  if (!this.lookupImport(context, request)) {
    // Check that it doesn't already exist in the queue, to prevent duplicates.
    // This isn't really necessary, and looping on every `push` isn't super
    // efficient, but we don't expect the queue to grow very large, and it's
    // cleaner if there are no duplicates.
    var existing = this.resolveQueue.filter(function(unresolvedImport) {
      return unresolvedImport[0] === context && unresolvedImport[1] === request;
    });
    if (!existing.length) {
      this.resolveQueue.push([context, request]);
    }
  }
};

ImportCache.prototype.flushImportQueue = function() {
  if (this.resolveQueue.length) {
    var self = this;
    var next = this.resolveQueue.shift();
    var context = next[0];
    var request = next[1];
    // We could use `Promise.all` and process the whole queue with as much
    // parallelism as webpack's `resolve` will allow, but that must not be much
    // because it didn't end up saving any time when tested.
    return this.resolveStylusImport(context, request).then(function() {
      return self.flushImportQueue();
    });
  } else {
    return Promise.resolve();
  }
};

ImportCache.prototype.addDependencies = function(filenames) {
  // We could just call `addDependency` from `loaderContext` here each time we
  // encounter some dependencies, but there will be lots of duplicates, and
  // we don't want to trust that webpack's implementation of `addDependency` is
  // efficient. So collect all dependencies until the end, then add them in one
  // batch.
  filenames.forEach(function(filename) {
    this.dependencies[filename] = true;
  }, this);
};

ImportCache.prototype.getDependencies = function() {
  return Object.keys(this.dependencies);
};

/**
 * Return a function suitable for passing to a Promise's `catch`, that
 * catches any `UnresolvedImport` errors and attempts to resolve them (along
 * with any other queued imports) before trying again via `done`.
 * @param {Function} done - A retry function that returns the final value or
 *                          a Promise.
 * @return {Function} A function for use with a Promise's `catch`.
 */
ImportCache.prototype.createUnresolvedImportHandler = function(done) {
  var self = this;
  return function(err) {
    if (!(err instanceof UnresolvedImport)) {
      throw err;
    }

    var context = err.importContext;
    var request = err.importRequest;

    self.enqueueImport(context, request);
    return self.flushImportQueue().then(done);
  };
};

module.exports = ImportCache;
