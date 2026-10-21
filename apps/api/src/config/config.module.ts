import { DynamicModule, Global, Module } from '@nestjs/common';
import { APP_CONFIG, AppConfig, loadConfig } from './env';

@Global()
@Module({})
export class ConfigModule {
  /** Pass an explicit config in tests; otherwise the process environment is validated. */
  static forRoot(config?: AppConfig): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: config ?? loadConfig() }],
      exports: [APP_CONFIG],
    };
  }
}
