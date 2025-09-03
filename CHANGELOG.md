## 0.3.4 (2025-08-08)

When handshake messages are not responded to by applications after 3 attempts that application is removed from the app resolver.
When an application is closed a WCP6Goodbye message is sent to the root agent and the application is removed from the app resolver.

## 0.3.3 (2025-08-04)

Fixed bugs around open strategies. Strategies that return `false` from `canOpen` are now correctly skipped and not used to open windows.

## 0.3.2 (2025-06-26)

 - Fixed a bug with `createRoot` that did not correctly pass the `identityUrl` to the `rootMessagePublisher`
 - Changed the `getAppDirectoryApplicationsImpl` to not append `/v2/apps` to app directory urls to allow non standard urls to be used

## 0.3.1 (2025-06-03)

Fixed a bug with `app-resolver.default` and `app-resolver.component` that did not automatically select an unqualified app id when there was only 1 suitable app available.

## 0.3.0 (2025-05-16)

### 🚀 Features

- Implemented heartbeat functionality for Desktop Agent
- **logging:** Enhance logging functionality with configurable log levels
- Added recursive back-off retry to App Directory loading logic 
- **build** Migrate from Jest to Vitest for testing framework 
- **build** Refactor mono repo config to use Nx targets rather than npm scripts
- **build** Type check spec files as part of build 
- **build** Optimize test harness build 
- **build** ESLint 9 Upgrade
- **dependencies** Updated to @finos/fdc3 2.2.0 release

### 🩹 Fixes

- Removed unbalanced parenthesis from error message and test for unknown channelId
- **documentation** Updated documentation links to point to the correct FDC3 specifications 

## 0.2.4 (2025-03-11)

Updated to @finos/fdc3 2.2.0-beta.3 release.

## 0.2.3 (2025-03-09)

Updated dependencies with Dependabot.

## 0.2.2 (2025-03-04)

This was a version bump only, there were no code changes.