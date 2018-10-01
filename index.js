'use strict';
var loaderUtils = require('loader-utils');
var stylus = require('stylus');
var Promise = require('es6-promise').Promise;

var CachedPathEvaluator = require('./lib/evaluator');
var ImportCache = require('./lib/import-cache');
var resolver = require('./lib/resolver');

var debug = require('debug')('stylus-relative-loader:index');

function needsArray(value) {
  return Array.isArray(value) ? value : [value];
}

module.exports = function(source) {
  var self = this;
  if (this.cacheable) {
    this.cacheable();
  }
  var done = this.async();
  var options = this.query ? loaderUtils.parseQuery(this.query) : {};

  options.dest = options.dest || '';
  options.filename = options.filename || this.resourcePath;
  options.Evaluator = CachedPathEvaluator;
  // Attach `importCache` to `options` so that the `Evaluator` can access it.
  var importCache = options.importCache = new ImportCache(this, options);

  var configKey;
  var stylusOptions;
  if (this.stylus) {
    configKey = options.config || 'default';
    stylusOptions = this.stylus[configKey] || {};
  } else if (this.options) {
    configKey = options.config || 'stylus';
    stylusOptions = this.options[configKey] || {};
  } else {
    stylusOptions = {};
  }

  // Instead of assigning to options, we run them manually later so their side
  // effects apply earlier for resolving paths.
  var use = needsArray(options.use || stylusOptions.use || []);
  options.use = [];
  options.import = options.import || stylusOptions.import || [];
  options.include = options.include || stylusOptions.include || [];
  options.set = options.set || stylusOptions.set || {};
  options.define = options.define || stylusOptions.define || {};
  options.paths = options.paths || stylusOptions.paths;

  if (options.sourceMap != null) {
    options.sourcemap = options.sourceMap;
    delete options.sourceMap;
  } else if (this.sourceMap) {
    options.sourcemap = { comment: false };
  }

  var styl = stylus(source, options);

  if (options.paths && !Array.isArray(options.paths)) {
    options.paths = [options.paths];
  }

  needsArray(use).forEach(function(plugin) {
    if (typeof plugin === 'function') {
      styl.use(plugin);
    } else {
      throw new Error('Plugin should be a function');
    }
  });

  Object.keys(options).forEach(function(key) {
    var value = options[key];
    if (key === 'set') {
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

  // `styl.render`, promisified.
  var renderStylus = function() {
    return new Promise(function(resolve, reject) {
      styl.render(function(err, css) {
        return err ? reject(err) : resolve(css);
      });
    });
  };

  var attempt = 0;

  function tryRender() {
    attempt += 1;
    return renderStylus().then(function(css) {
      return {
        css: css,
        sourcemap: styl.sourcemap
      };
    }).catch(function(err) {
      debug('Error: %s', err);
      return importCache.handleUnresolvedImport(err).then(tryRender);
    });
  }

  // Visit this base file before even attempting to render, so we can already
  // have a bunch of imports in the cache.
  importCache.enqueueVisit(options.filename, source);

  debug('Starting: %s', options.filename);

  importCache.flushQueues().then(function() {
    return tryRender().then(function(result) {
      // Tell `webpack` about all the dependencies found during render.
      importCache.getDependencies().forEach(function(file) {
        self.addDependency(file);
      });
      debug('Render attempts: %s', attempt);
      done(null, result.css, result.sourcemap);
    });
  }).catch(done);
};
