var app = require('./app');
var config = require('./config');
var openhim = require('./openhim');

var logger = {
  info: function () {
    console.log.apply(console, arguments);
  },
  error: function () {
    console.error.apply(console, arguments);
  },
  debug: function () {
    if (process.env.DEBUG === 'true') {
      console.log.apply(console, arguments);
    }
  }
};

app.listen(config.port, function () {
  logger.info('Mediator listening on port ' + config.port);

  openhim.maybeRegisterMediator(config, logger).catch(function (error) {
    logger.error('Failed to register mediator with OpenHIM:', error.message || error);
  });
});
