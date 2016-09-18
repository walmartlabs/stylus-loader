'use strict';
var path = require('path');
var Promise = require('es6-promise').Promise;
var loaderUtils = require('loader-utils');
var UnresolvedImport = require('./unresolved-import');
var visitImports = require('./import-visitor');

function ImportCache(loaderContext, options) {
  // webpack's `resolve`, promisified.
  this.resolve = function(context, request) {
    return new Promise(function(resolve, reject) {
      loaderContext.resolve(context, request, function(err, result) {
        return err ? reject(err) : resolve(result);
      });
    });
  };
  this.resolveCache = {};
  this.resolveQueue = [];
  this.dependencies = {};
  this.visitQueue = [];
  this.visitCache = {};
  this.visitImports = visitImports;
  this.options = options;
}

ImportCache.prototype.nameToRequest = function(name) {
  return loaderUtils.urlToRequest(name, this.options.root);
};

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
 * @param {Boolean} visitOnly - Whether we're only trying to resolve this file
 *                              in order to visit imports, in which case we don't
 *                              care if resolution fails.
 * @return {Promise} Promise that will evaluate to the resolved import path,
 *                   or throw if it can't be resolved.
 */
ImportCache.prototype.resolveStylusImport = function(context, request, visitOnly) {
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

  return resolveRequest.catch(function(err) {
    // This import is probably relying on Stylus' import logic, not webpack's,
    // which we *could* duplicate here, although it would be difficult to
    // duplicate the same stack of `paths`. Anyway, if we're only trying to
    // resolve this file for the purposes of visiting imports (to speed things
    // up), then we can ignore it.
    if (!visitOnly) {
      throw err;
    }
  }).then(function(result) {
    if (result) {
      self.enqueueVisit(result);
      self.cacheImport(context, request, result);
      self.cacheImport(context, finalRequest, result);
    }
    return result;
  });
};

ImportCache.prototype.enqueueVisit = function(filename, source) {
  // Don't visit non-Stylus files or those already visited.
  if (/\.styl$/i.test(filename) && !this.visitCache[filename]) {
    var existing = this.visitQueue.filter(function(visit) {
      return visit[0] === filename;
    });
    if (!existing.length) {
      this.visitQueue.push([filename, source]);
    }
  }
};

ImportCache.prototype.enqueueImport = function(context, request, visitOnly) {
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
      this.resolveQueue.push([context, request, visitOnly]);
    }
  }
};

ImportCache.prototype.flushVisitQueue = function() {
  if (this.visitQueue.length) {
    // Flush the queue in parallel since we have a worker farm.
    var visit = this.visitQueue.shift();
    var filename = visit[0];
    var source = visit[1];
    if (this.visitCache[filename]) {
      return Promise.resolve();
    }
    this.visitCache[filename] = true;
    var self = this;
    var importVariables = this.options.precacheImportVariables;
    return this.visitImports(filename, source, importVariables).then(
      function(importPaths) {
        importPaths.forEach(function(importPath) {
          var context = importPath[0];
          var request = this.nameToRequest(importPath[1]);
          this.enqueueImport(context, request, true);
        }, self);
        return self.flushVisitQueue();
      }
    );
  } else {
    return Promise.resolve();
  }
};

ImportCache.prototype.flushImportQueue = function() {
  if (this.resolveQueue.length) {
    // Flush the queue in series. We could use `Promise.all` to resolve
    // everything in parallel, but it wasn't found to be any faster.
    var next = this.resolveQueue.shift();
    var context = next[0];
    var request = next[1];
    var visitOnly = next[2];
    return this.resolveStylusImport(context, request, visitOnly)
      .then(this.flushQueues.bind(this));
  } else {
    return Promise.resolve();
  }
};

ImportCache.prototype.flushQueues = function() {
  // Flush both queues in parallel, but make sure `flushImportQueue` is run
  // again at the end.
  return Promise.all([
    this.flushVisitQueue(),
    this.flushImportQueue()
  ]).then(this.flushImportQueue.bind(this));
};

ImportCache.prototype.addDependencies = function(filenames) {
  // We could just call `addDependency` from `loaderContext` here each time we
  // encounter some dependencies, but there will be lots of duplicates, and
  // we don't want to trust that webpack's implementation of `addDependency` is
  // efficient. So collect all dependencies until the end, then add them in one
  // batch.
  filenames.forEach(function(filename) {
    this.enqueueVisit(filename);
    this.dependencies[filename] = true;
  }, this);
};

ImportCache.prototype.getDependencies = function() {
  return Object.keys(this.dependencies);
};

ImportCache.prototype.handleUnresolvedImport = function(err) {
  if (err instanceof UnresolvedImport) {
    var context = err.importContext;
    var request = err.importRequest;
    this.enqueueImport(context, request);
    return this.flushQueues();
  } else {
    throw err;
  }
};

module.exports = ImportCache;
