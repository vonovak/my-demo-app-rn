import {MobileConfig} from '../configs/wdio.shared.conf';

const getTextOfElement = async (
  element: WebdriverIO.Element,
): Promise<string> => {
  let visualText = '';

  try {
    // Android doesn't hold the text on the parent element
    // so each text view in the parent needs to be checked
    if (driver.isAndroid) {
      const elements = await element.$$('*//android.widget.TextView');
      for (let elm of elements) {
        visualText = `${visualText} ${await elm.getText()}`;
      }
    } else {
      visualText = await element.getText();
    }
  } catch (e) {
    visualText = await element.getText();
  }

  return visualText.trim();
};
const locatorStrategy = (selector: string): string => {
  return driver.isIOS ? `id=${selector}` : `//*[@content-desc="${selector}"]`;
};
const restartApp = async (): Promise<void> => {
  if (!(driver.config as MobileConfig).firstAppStart) {
    await driver.reset();
  }

  // Set the firstAppstart to false to say that the following test can be reset
  (driver.config as MobileConfig).firstAppStart = false;
};
const hideKeyboard = async (): Promise<void> => {
  // The hideKeyboard is not working on ios devices, so take a different approach
  if (!(await driver.isKeyboardShown())) {
    return;
  }

  if (driver.isIOS) {
    await $('id=Return').click();
  } else {
    try {
      await driver.hideKeyboard('pressKey', 'Done');
    } catch (e) {
      // Fallback
      await driver.back();
    }
  }

  // Wait for the keyboard animation to be done
  await driver.pause(750);
};
const hideNumericKeyboard = async (): Promise<void> => {
  // The hideKeyboard is not working on ios devices, so take a different approach
  if (!(await driver.isKeyboardShown())) {
    return;
  }

  if (driver.isIOS) {
    await driver.execute('mobile: tap', {
      element: await $('id=1'),
      x: 0,
      y: -100,
    });
  } else {
    try {
      await driver.hideKeyboard('pressKey', 'Done');
    } catch (e) {
      // Fallback
      await driver.back();
    }
  }

  // Wait for the keyboard animation to be done
  await driver.pause(750);
};
const openDeepLinkUrl = async (url: string): Promise<void | string> => {
  const prefix = 'mydemoapprn://';

  if (driver.isAndroid) {
    // Life is so much easier
    return driver.execute('mobile:deepLink', {
      url: `${prefix}${url}`,
      package: 'com.saucelabs.mydemoapp.rn',
    });
  }

  // We can use `driver.url` on iOS simulators, but not on iOS real devices. The reason is that iOS real devices
  // open Siri when you call `driver.url('')` to use a deep link. This means that real devices need to have a different implementation
  // then iOS sims
  // iOS sims and real devices can be distinguished by their UDID. Based on these sources there is a diff in the UDIDS
  // - https://blog.diawi.com/2018/10/15/2018-apple-devices-and-their-new-udid-format/
  // - https://www.theiphonewiki.com/wiki/UDID
  // iOS sims have more than 1 `-` in the UDID and the UDID is being
  const simulatorRegex = new RegExp('(.*-.*){2,}');

  // Check if we are a simulator
  if (
    'udid' in driver.capabilities &&
    simulatorRegex.test(driver.capabilities.udid as string)
  ) {
    await driver.url(`${prefix}${url}`);
  } else {
    // Else we are a real device and we need to take some extra steps
    // Launch Safari to open the deep link
    await driver.execute('mobile: launchApp', {
      bundleId: 'com.apple.mobilesafari',
    });

    // Add the deep link url in Safari in the `URL`-field
    // This can be 2 different elements, or the button, or the text field
    // Use the predicate string because  the accessibility label will return 2 different types
    // of elements making it flaky to use. With predicate string we can be more precise
    const addressBarSelector =
      "name CONTAINS 'URL' OR name CONTAINS 'TabBarItemTitle' OR value contains 'Search or enter website name'";
    const urlFieldSelector =
      'type == "XCUIElementTypeTextField" && name CONTAINS "URL"';
    const addressBar = $(`-ios predicate string:${addressBarSelector}`);
    const urlField = $(`-ios predicate string:${urlFieldSelector}`);

    // Wait for the url button to appear and click on it so the text field will appear
    // iOS 13 now has the keyboard open by default because the URL field has focus when opening the Safari browser
    if (!(await driver.isKeyboardShown())) {
      await addressBar.waitForDisplayed();
      await addressBar.click();
    }

    // Submit the url and add a break
    await urlField.setValue(`${prefix}${url}\uE007`);
  }

  // Wait for the notification and accept it
  // When using an iOS simulator you will only get the pop-up once, all the other times it won't be shown
  try {
    const openSelector =
      "type == 'XCUIElementTypeButton' && name CONTAINS 'Open'";
    const openButton = $(`-ios predicate string:${openSelector}`);
    // Assumption is made that the alert will be seen within 2 seconds, if not it did not appear
    await openButton.waitForDisplayed({timeout: 3000});
    await openButton.click();
  } catch (e) {
    // ignore
    console.log('Deeplink error = ', e);
  }
};

/**
 * Get the app state for iOS, see
 * http://appium.io/docs/en/writing-running-appium/ios/ios-xctest-mobile-apps-management/
 *  0: 'The current application state cannot be determined/is unknown',
 *  1: 'The application is not running',
 *  2: 'The application is running in the background and is suspended',
 *  3: 'The application is running in the background and is not suspended',
 *  4: 'The application is running in the foreground',
 */
const getIosAppState = (bundleId: string): Promise<number> => {
  return driver.execute('mobile: queryAppState', {bundleId: bundleId});
};

/**
 * Check if the application is running in the foreground
 */
const isIosApplicationRunning = async (bundleId: string): Promise<boolean> => {
  try {
    await driver.waitUntil(async () => (await getIosAppState(bundleId)) === 4);
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Verify that the apps main activity is not open anymore, this means that the browser, or the choose browser
 * helper is opened
 */
const androidBrowserOpened = async (): Promise<boolean> => {
  try {
    await driver.waitUntil(
      async () =>
        !(await driver.getCurrentActivity()).includes('.MainActivity') &&
        !(
          await driver.getCurrentActivity()
        ).includes('.GrantPermissionsActivity'),
    );

    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Verify that the browser is opened.
 * - iOS:     For iOS we can check if Safari is running in the foreground
 * - Android: For Android we can check the current activity. If it holds a browser reference we know
 *            for sure that the app is put on the background and that for example chrome is opened.
 */
const isBrowserOpened = async (): Promise<boolean> => {
  if (driver.isIOS) {
    return isIosApplicationRunning('com.apple.mobilesafari');
  }

  return androidBrowserOpened();
};

export {
  getTextOfElement,
  hideKeyboard,
  hideNumericKeyboard,
  isBrowserOpened,
  locatorStrategy,
  openDeepLinkUrl,
  restartApp,
};
