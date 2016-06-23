import { ICordova, ILogger, IDevice, IEventEmitter } from './interfaces';

declare var cordova: any;

export interface CordovaOptions {}

export class Cordova implements ICordova {

  constructor(protected options: CordovaOptions = {}, public device: IDevice, public emitter: IEventEmitter, public logger: ILogger) {}

  public bootstrap(): void {
    let events = ['pause', 'resume'];

    document.addEventListener('deviceready', (...args) => {
      this.emitter.emit('cordova:deviceready', {'args': args});

      for (let e of events) {
        document.addEventListener(e, (...args) => {
          this.emitter.emit('cordova:' + e, {'args': args});
        }, false);
      }
    }, false);

    this.load();
  }

  public load(): void {
    if (!this.isAvailable()) {
      var cordovaScript = document.createElement('script');
      var cordovaSrc = 'cordova.js';
      switch (this.device.deviceType) {
        case 'android':
          if (window.location.href.substring(0, 4) === 'file') {
            cordovaSrc = 'file:///android_asset/www/cordova.js';
          }
          break;

        case 'ipad':
        case 'iphone':
          try {
            var resource = window.location.search.match(/cordova_js_bootstrap_resource=(.*?)(&|#|$)/i);
            if (resource) {
              cordovaSrc = decodeURI(resource[1]);
            }
          } catch (e) {
            if (this.logger) {
              this.logger.info('Ionic Cordova: could not find cordova_js_bootstrap_resource query param');
              this.logger.info('Ionic Cordova:', e);
            }
          }
          break;

        default:
          break;
      }
      cordovaScript.setAttribute('src', cordovaSrc);
      document.head.appendChild(cordovaScript);
      if (this.logger) {
        this.logger.info('Ionic Cordova: injecting cordova.js');
      }
    }
  }

  private isAvailable(): boolean {
    if (this.logger) {
      this.logger.info('Ionic Cordova: searching for cordova.js');
    }

    if (typeof cordova !== 'undefined') {
      if (this.logger) {
        this.logger.info('Ionic Cordova: cordova.js has already been loaded');
      }
      return true;
    }

    var scripts = document.getElementsByTagName('script');
    var len = scripts.length;
    for (var i = 0; i < len; i++) {
      var script = scripts[i].getAttribute('src');
      if (script) {
        var parts = script.split('/');
        var partsLength = 0;
        try {
          partsLength = parts.length;
          if (parts[partsLength - 1] === 'cordova.js') {
            if (this.logger) {
              this.logger.info('Ionic Cordova: cordova.js has previously been included.');
            }
            return true;
          }
        } catch (e) {
          if (this.logger) {
            this.logger.info('Ionic Cordova: encountered error while testing for cordova.js presence, ' + e.toString());
          }
        }
      }
    }

    return false;
  }

}