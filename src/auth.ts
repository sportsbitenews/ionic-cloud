import { IConfig, IClient, IEventEmitter, TokenContextDependencies, CombinedTokenContextDependencies, ITokenContext, ICombinedTokenContext, ICombinedTokenContextStoreOptions, IStorage, ISingleUserService, AuthModuleId, LoginOptions, AuthDependencies, AuthOptions, IAuth, IUser, AuthTypeDependencies, IAuthType, UserDetails, BasicLoginCredentials, IBasicAuthType, IAuthModules } from './definitions';
import { DetailedError } from './errors';
import { DeferredPromise } from './promise';

declare var window: any;

export class AuthTokenContext implements ITokenContext {
  private storage: IStorage<string>;

  constructor(deps: TokenContextDependencies, public label: string) {
    this.storage = deps.storage;
  }

  get(): string {
    return this.storage.get(this.label);
  }

  store(token: string): void {
    this.storage.set(this.label, token);
  }

  delete(): void {
    this.storage.delete(this.label);
  }
}

export class CombinedAuthTokenContext implements ICombinedTokenContext {
  private storage: IStorage<string>;
  private tempStorage: IStorage<string>;

  constructor(deps: CombinedTokenContextDependencies, public label: string) {
    this.storage = deps.storage;
    this.tempStorage = deps.tempStorage;
  }

  get(): string {
    let permToken = this.storage.get(this.label);
    let tempToken = this.tempStorage.get(this.label);
    let token = tempToken || permToken;
    return token;
  }

  store(token: string, options: ICombinedTokenContextStoreOptions = {'permanent': true}): void {
    if (options.permanent) {
      this.storage.set(this.label, token);
    } else {
      this.tempStorage.set(this.label, token);
    }
  }

  delete(): void {
    this.storage.delete(this.label);
    this.tempStorage.delete(this.label);
  }
}

export class Auth implements IAuth {

  private emitter: IEventEmitter;
  private authModules: IAuthModules;
  private tokenContext: ICombinedTokenContext;
  private userService: ISingleUserService;

  private authToken: string;

  constructor(
    deps: AuthDependencies,
    public options: AuthOptions = {}
  ) {
    this.emitter = deps.emitter;
    this.authModules = deps.authModules;
    this.tokenContext = deps.tokenContext;
    this.userService = deps.userService;
  }

  isAuthenticated(): boolean {
    let token = this.tokenContext.get();
    if (token) {
      return true;
    }
    return false;
  }

  login(moduleId: AuthModuleId, data?: Object, options: LoginOptions = {'remember': true}): Promise<IUser> {
    let context = this.authModules[moduleId];
    if (!context) {
      throw new Error('Authentication class is invalid or missing:' + context);
    }

    return context.authenticate(data).then((token: string) => {
      this.storeToken(options, token);

      return this.userService.load().then(() => {
        let user = this.userService.current();
        user.store();
        return user;
      });
    });
  }

  signup(data: UserDetails): Promise<void> {
    let context = this.authModules.basic;
    if (!context) {
      throw new Error('Authentication class is invalid or missing:' + context);
    }
    return context.signup.apply(context, [data]);
  }

  logout(): void {
    this.tokenContext.delete();
    let user = this.userService.current();
    user.unstore();
    user.clear();
  }

  getToken(): string {
    return this.tokenContext.get();
  }

  storeToken(options: LoginOptions = {'remember': true}, token: string) {
    let originalToken = this.authToken;
    this.authToken = token;
    this.tokenContext.store(this.authToken, {'permanent': options.remember});
    this.emitter.emit('auth:token-changed', {'old': originalToken, 'new': this.authToken});
  }

  static getDetailedErrorFromResponse(res): DetailedError<string[]> {
    let errors = [];
    let details = [];

    try {
      details = res.body.error.details;
    } catch (e) {}

    for (let i = 0; i < details.length; i++) {
      let detail = details[i];
      if (detail.error_type) {
        errors.push(detail.error_type + '_' + detail.parameter);
      }
    }

    return new DetailedError<string[]>('Error creating user', errors);
  }

}

export abstract class AuthType implements IAuthType {
  public config: IConfig;
  public client: IClient;

  constructor(deps: AuthTypeDependencies) {
    this.config = deps.config;
    this.client = deps.client;
  }

  abstract authenticate(data?: Object): Promise<any>;

  protected inAppBrowserFlow(options, data: Object = {}): Promise<string> {
    let deferred = new DeferredPromise<string, Error>();

    if (!window || !window.cordova || !window.cordova.InAppBrowser) {
      deferred.reject(new Error('InAppBrowser plugin missing'));
    } else {
      let method = options.uri_method ? options.uri_method : 'POST';
      let provider = options.provider ? '/' + options.provider : '';

      this.client.request(method, `/auth/login${provider}`)
        .send({
          'app_id': this.config.get('app_id'),
          'callback': options.callback_uri || window.location.href,
          'data': data
        })
        .end((err, res) => {
          if (err) {
            deferred.reject(err);
          } else {
            let w = window.cordova.InAppBrowser.open(
              res.body.data.url,
              '_blank',
              'location=no,clearcache=yes,clearsessioncache=yes'
            );

            let onExit = () => {
              deferred.reject(new Error('InAppBrowser exit'));
            };

            let onLoadError = () => {
              deferred.reject(new Error('InAppBrowser loaderror'));
            };

            let onLoadStart = (data) => {
              if (data.url.slice(0, 20) === 'http://auth.ionic.io') {
                let queryString = data.url.split('#')[0].split('?')[1];
                let paramParts = queryString.split('&');
                let params = {};
                for (let i = 0; i < paramParts.length; i++) {
                  let part = paramParts[i].split('=');
                  params[part[0]] = part[1];
                }
                w.removeEventListener('exit', onExit);
                w.removeEventListener('loaderror', onLoadError);
                w.close();
                deferred.resolve(params['token']);
              } else {
                deferred.reject(new Error('Unexpected url in API response'));
              }
            };

            w.addEventListener('exit', onExit);
            w.addEventListener('loaderror', onLoadError);
            w.addEventListener('loadstart', onLoadStart);
          }
        });
    }

    return deferred.promise;
  }

}

export class BasicAuth extends AuthType implements IBasicAuthType {

  authenticate(data: BasicLoginCredentials): Promise<string> {
    var deferred = new DeferredPromise<string, Error>();

    if (!data.email || !data.password) {
      deferred.reject(new Error('email and password are required for basic authentication'));
    } else {
      this.client.post('/auth/login')
        .send({
          'app_id': this.config.get('app_id'),
          'email': data.email,
          'password': data.password
        })
        .end((err, res) => {
          if (err) {
            deferred.reject(err);
          } else {
            deferred.resolve(res.body.data.token);
          }
        });
    }

    return deferred.promise;
  }

  signup(data: UserDetails): Promise<void> {
    var deferred = new DeferredPromise<void, DetailedError<string[]>>();

    var userData: any = {
      'app_id': this.config.get('app_id'),
      'email': data.email,
      'password': data.password
    };

    // optional details
    if (data.username) { userData.username = data.username; }
    if (data.image) { userData.image = data.image; }
    if (data.name) { userData.name = data.name; }
    if (data.custom) { userData.custom = data.custom; }

    this.client.post('/users')
      .send(userData)
      .end((err, res) => {
        if (err) {
          deferred.reject(Auth.getDetailedErrorFromResponse(err.response));
        } else {
          deferred.resolve();
        }
      });

    return deferred.promise;
  }
}

export class CustomAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'custom' }, data);
  }
}

export class TwitterAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'twitter' }, data);
  }
}

export class FacebookAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'facebook' }, data);
  }
}

export class GithubAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'github' }, data);
  }
}

export class GoogleAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'google' }, data);
  }
}

export class InstagramAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'instagram' }, data);
  }
}

export class LinkedInAuth extends AuthType {
  authenticate(data: Object = {}): Promise<any> {
    return this.inAppBrowserFlow({ 'provider': 'linkedin' }, data);
  }
}
