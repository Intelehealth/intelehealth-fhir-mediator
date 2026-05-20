var fs = require('fs');
var path = require('path');
var url = require('url');
var openhimUtils = require('openhim-mediator-utils');

function loadMediatorConfig(config) {
  var configPath = path.join(__dirname, '..', 'mediatorConfig.json');
  var mediatorConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  var parsedRouterUrl;

  mediatorConfig.urn = config.openhim.urn;

  if (config.openhim.routerUrl) {
    parsedRouterUrl = url.parse(config.openhim.routerUrl);

    if (parsedRouterUrl.hostname && mediatorConfig.endpoints && mediatorConfig.endpoints[0]) {
      mediatorConfig.endpoints[0].host = parsedRouterUrl.hostname;
    }

    if (parsedRouterUrl.port && mediatorConfig.endpoints && mediatorConfig.endpoints[0]) {
      mediatorConfig.endpoints[0].port = parseInt(parsedRouterUrl.port, 10);
    }
  }

  return mediatorConfig;
}

function maybeRegisterMediator(config, logger) {
  var options;
  var mediatorConfig;
  var heartbeat;

  if (!config.openhim.register) {
    logger.info('OpenHIM registration disabled.');
    return Promise.resolve();
  }

  if (!config.openhim.apiUrl || !config.openhim.username || !config.openhim.password) {
    return Promise.reject(new Error('OpenHIM registration is enabled but API URL or credentials are missing.'));
  }

  options = {
    apiURL: config.openhim.apiUrl,
    username: config.openhim.username,
    password: config.openhim.password,
    urn: config.openhim.urn,
    trustSelfSigned: config.openhim.trustSelfSigned
  };

  mediatorConfig = loadMediatorConfig(config);

  return new Promise(function (resolve, reject) {
    openhimUtils.registerMediator(options, mediatorConfig, function (error) {
      if (error) {
        reject(error);
        return;
      }

      logger.info('Mediator registered with OpenHIM.');

      heartbeat = openhimUtils.activateHeartbeat(options, config.openhim.heartbeatMs);
      heartbeat.on('config', function (updatedConfig) {
        logger.info('OpenHIM config received.');
        logger.debug(updatedConfig);
      });
      heartbeat.on('error', function (heartbeatError) {
        logger.error('OpenHIM heartbeat error:', heartbeatError.message || heartbeatError);
      });

      resolve();
    });
  });
}

module.exports = {
  maybeRegisterMediator: maybeRegisterMediator
};
