# @morgan-stanley/fdc3-web-test-harness
This project provides a testing environment for FDC3 features and the interoperability of FDC3-compliant applications. It encompasses a variety of tests, from basic feature verification to complex scenarios involving interactions between apps from the same or different origins. Additionally, it facilitates the testing of multiple applications operating concurrently within a single browser window, including the dynamic addition of applications both within the root app and at the first level.

To simulate the cross-origin scenarios it runs applications on different local ports.

**Current Features:**
1. Raise and Handle Intent between applications.
2. Enables dynamic addition of applications. When adding a new application, you can select the intents you wish to support and raise for the new app via the settings panel.
3. A Resolver UI is provided to select an application when the raised intent is supported by multiple applications.
4. Channel Selector

Applications are added to the root window by default. To add an application within a first-level app, select the target app by clicking on its header, then click on the `Add App` button to add the new application in the selected app.

### Running the Test Harness Locally
```bash
npm start
```
This command builds all configured applications in watch mode and starts a server to host the apps. Access the test harness by navigating to `http://localhost:4300/root-app.html` in your browser.

### Building the Test Harness
To build the test harness for deployment:
```bash
npm run build
```

### Configuration of Apps in the Test Harness
```test-harness-config.json```
This file contains the configuration for the apps that can be added either by default or dynamically, with currently 10 apps configured across 6 different domains. More apps can be added to this configuration by following the established format. Apps marked with `default`: true are added by default upon loading the test harness, while other apps are made available in the `Select App` dropdown of the settings panel for dynamic addition at a later time. For apps added by default, the intents that are to be raised and supported by each app can also be specified.