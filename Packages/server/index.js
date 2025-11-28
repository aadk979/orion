/**
 * Orion Package Exports
 * 
 * Main entry point for the Orion Alpine authentication framework.
 * Exports all public APIs, utilities, and core functionality.
 */

import { initiateServer } from "./lib/Server/initiateServer.js";
import { globalAccessPoint } from "./lib/Utils/GlobalAccessPoint.js";
import { packageExports as o } from "./lib/Utils/Ip.js";
import { packageExports as r } from "./lib/Utils/Validator.js";
import { packageExports as i } from "./lib/Utils/valueGenerator.js";
import { packageExports as on } from "./lib/Utils/Encoders.js";
import { packageExports as is } from "./lib/Utils/Date&Time.js";
import { packageExports as b} from "./lib/Utils/CryptoFunctions.js";
import { getDeviceDetails } from "./lib/Utils/Device.js";
import { cronScheduler } from "./lib/Utils/Cron.js";
import { sanitizeString } from "./lib/Utils/Sanitizer.js";
import { getCookie, parseCookieData, setCookie } from "./lib/Utils/CookieUtils.js";
import { readFromCaller, writeToCaller } from "./lib/Utils/FileHandler.js";
import { generateResourceToken } from "./lib/Utils/Core/ResourceAccessManagment/callbackBasedResources/resourceTokens.js";
import { requestContext } from "./lib/Server/Middleware/requestMetadata.js";
import { logger } from "./lib/Utils/logger.js";
import { userControl } from "./lib/Utils/Core/AccountManagment/UserControl.js";

const validators = o;
const ipUtils = r;
const encodersAndDecoders = on;
const uaParser = { getDeviceDetails };
const dateAndTime = is;
const cron = cronScheduler;
const sanitizer = { sanitizeString };
const cookies = { parseCookieData, setCookie, getCookie };
const fileIO = { writeToCaller, readFromCaller };
const tokens = { generateResourceToken };
const valueGenerators = i;
const orionCrypto = b;

const __Version__ = "1.0.0";
const __Status__ = "Beta";

const orionInfo = { __Version__, __Status__ }

export {
  initiateServer,
  globalAccessPoint,
  validators,
  ipUtils,
  encodersAndDecoders,
  uaParser,
  dateAndTime,
  cron,
  sanitizer,
  cookies,
  fileIO,
  tokens,
  valueGenerators,
  orionCrypto,
  orionInfo,
  requestContext,
  logger,
  userControl
};