let debug = require('debug')('taskcluster-lib-monitor');
let _ = require('lodash');
let assert = require('assert');
let Promise = require('promise');
var taskcluster = require('taskcluster-client');
var raven = require('raven');
let Statsum = require('statsum');

class Monitor {

  constructor (authClient, sentryClient, statsumClient, opts) {
    this._opts = opts;
    this._auth = authClient;
    this._sentry = sentryClient;
    this._statsum = statsumClient;

    if (opts.reportStatsumErrors) {
      this._statsum.on('error', err => this.reportError(err, 'warning'));
    }
  }

  async reportError (err, level='error') {
    if (!this._sentry.expires || Date.parse(this._sentry.expires) <= Date.now()) {
      let sentryInfo = await this._auth.sentryDSN(this._opts.project);
      this._sentry.client = new raven.Client(sentryInfo.dsn.secret);
      this._sentry.expires = sentryInfo.expires;
      if (this._opts.patchGlobal) {
        this._sentry.client.patchGlobal((logged, err) => {
          console.log(err.stack);
          if (logged) {
            console.log('Finished reporting fatal error to sentry. Exiting now.');
          } else {
            console.log('Failed to report fatal error to sentry! Exiting now.');
          }
          process.exit(1);
        });
      }
    }
    this._sentry.client.captureException(err, {level});
  }

  count (key, val) {
    this._statsum.count(key, val);
  }

  measure (key, val) {
    this._statsum.measure(key, val);
  }

  async flush () {
    await this._statsum.flush();
  }

  prefix (prefix) {
    return new Monitor(
      this._auth,
      this._sentry,
      this._statsum.prefix(prefix),
      this._opts
    );
  }
}

async function monitor (options) {
  assert(options.credentials, 'Must provide taskcluster credentials!');
  assert(options.project, 'Must provide a project name!');
  let opts = _.defaults(options, {
    patchGlobal: true,
    reportStatsumErrors: true,
  });

  let authClient = new taskcluster.Auth({
    credentials: options.credentials,
  });

  let statsumClient = new Statsum(
    project => authClient.statsumToken(project),
    {
      project: opts.project,
      emitErrors: opts.reportStatsumErrors,
    }
  );

  return new Monitor(authClient, {}, statsumClient, opts);
};

module.exports = monitor;
