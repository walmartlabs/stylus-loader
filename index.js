'use strict';
var loaderUtils = require('loader-utils');
var stylus = require('stylus');
var path = require('path');
var whenNodefn = require('when/node/function');

var CachedPathEvaluator = require('./lib/evaluator');
var UnresolvedImport = require('./lib/unresolved-import');
var resolver = require('./lib/resolver');

module.exports = function(source) {
  var self = this;
  if (this.cacheable) {
    this.cacheable();
  }
  var done = this.async();
  var options = loaderUtils.parseQuery(this.query);
  options.dest = options.dest || '';
  options.filename = options.filename || this.resourcePath;
  options.Evaluator = CachedPathEvaluator;
  // Keep track of webpack-resolved imports.
  options.resolvedImports = {};

  var dependencies = {};
  options.addDependencies = function(filenames) {
    filenames.forEach(function(filename) {
      dependencies[filename] = true;
    });
  };

  var configKey = options.config || 'stylus';
  var stylusOptions = this.options[configKey] || {};

  options.use = options.use || stylusOptions.use || [];
  options.import = options.import || stylusOptions.import || [];
  options.include = options.include || stylusOptions.include || [];
  options.set = options.set || stylusOptions.set || {};
  options.define = options.define || stylusOptions.define || {};

  if (options.sourceMap != null) {
    options.sourcemap = options.sourceMap;
    delete options.sourceMap;
  } else if (this.sourceMap) {
    options.sourcemap = { comment: false };
  }

  var styl = stylus(source, options);
  var paths = [path.dirname(options.filename)];

  function needsArray(value) {
    return Array.isArray(value) ? value : [value];
  }

  if (options.paths && !Array.isArray(options.paths)) {
    paths = paths.concat(options.paths);
    options.paths = [options.paths];
  }

  Object.keys(options).forEach(function(key) {
    var value = options[key];
    if (key === 'use') {
      needsArray(value).forEach(function(plugin) {
        if (typeof plugin === 'function') {
          styl.use(plugin);
        } else {
          throw new Error('Plugin should be a function');
        }
      });
    } else if (key === 'set') {
      for (var name in value) {
        styl.set(name, value[name]);
      }
    } else if (key === 'define') {
      for (var defineName in value) {
        styl.define(defineName, value[defineName]);
      }
    } else if (key === 'include') {
      needsArray(value).forEach(function(includePath) {
        styl.include(includePath);
      });
    } else if (key === 'import') {
      needsArray(value).forEach(function(file) {
        styl.import(file);
      });
    } else {
      styl.set(key, value);

      if (key === 'resolve url' && value) {
        styl.define('url', resolver());
      }
    }
  });

  // TODO: This code could all still be perfectly valid with the new approach,
  // look into it. -BB
  /*
  var shouldCacheImports = stylusOptions.importsCache !== false;

  var importsCache;
  if (stylusOptions.importsCache !== false) {
    if (typeof stylusOptions.importsCache === 'object') {
      importsCache = stylusOptions.importsCache;
    } else {
      if(!globalImportsCaches[configKey]) globalImportsCaches[configKey] = {};
      importsCache = globalImportsCaches[configKey];
    }
  }

  // Use input file system's readFile if available. The normal webpack input
  // file system is cached with entries purged when they are detected to be
  // changed on disk by the watcher.
  var readFile;
  try {
    var inputFileSystem = this._compiler.inputFileSystem;
    readFile = inputFileSystem.readFile.bind(inputFileSystem);
  } catch (error) {
    readFile = fs.readFile;
  }
  */

  // `styl.render`, promisified.
  var renderStylus = whenNodefn.lift(styl.render).bind(styl);
  // webpack's `resolve`, promisified.
  var resolve = whenNodefn.lift(self.resolve).bind(self);

  function tryRender() {
    return renderStylus().then(function(css) {
      // TODO: Figure out how to add back sourcemap. -BB
      /*
      if (styl.sourcemap) {
        styl.sourcemap.sourcesContent = styl.sourcemap.sources.map(function (file) {
          return importPathCache.sources[path.resolve(file)]
        });
      }
      */
      return {
        css: css,
        sourcemap: styl.sourcemap
      };
    }).catch(function(err) {
      if (!(err instanceof UnresolvedImport)) {
        throw err;
      }

      var context = err.importContext;
      var originalRequest = err.importRequest;
      var request = originalRequest;
      var indexRequest;

      // Check if it's a CSS import.
      var literal = /\.css(?:"|$)/.test(request);

      // If it's not CSS and it doesn't end in .styl, try adding '.styl'
      // and '/index.styl'
      if (!literal && !/\.styl$/i.test(request)) {
        request += '.styl';
        indexRequest = path.join(originalRequest, 'index.styl');
      }

      var resolveRequest = resolve(context, request);

      if (indexRequest) {
        resolveRequest = resolveRequest.catch(function() {
          request = indexRequest;
          return resolve(context, request);
        });
      }

      return resolveRequest.then(function(result) {
        var contextImports = options.resolvedImports[context] || {};
        contextImports[request] = result;
        contextImports[originalRequest] = result;
        options.resolvedImports[context] = contextImports;
        return tryRender();
      });
    });
  }

  tryRender().then(function(result) {
    Object.keys(dependencies).forEach(function(filename) {
      self.addDependency(filename);
    });
    done(null, result.css, result.sourcemap);
  }).catch(done);
};
