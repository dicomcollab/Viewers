import {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality1x4Protocol,
  allModalityCompare2x1Protocol,
  usModality1x4Protocol,
} from './allModalityProtocols';

/**
 * Registers hanging protocols for the application
 * This module exports a function that returns an array of hanging protocol definitions
 * that can be registered with the HangingProtocolService
 */
export default function getHangingProtocolModule() {
  return [
    {
      name: allModality1x1Protocol.id,
      protocol: allModality1x1Protocol,
    },
    {
      name: allModality1x2Protocol.id,
      protocol: allModality1x2Protocol,
    },
    {
      name: allModality1x4Protocol.id,
      protocol: allModality1x4Protocol,
    },
    {
      name: allModalityCompare2x1Protocol.id,
      protocol: allModalityCompare2x1Protocol,
    },
    {
      name: usModality1x4Protocol.id,
      protocol: usModality1x4Protocol,
    },
  ];
}

export {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality1x4Protocol,
  allModalityCompare2x1Protocol,
  usModality1x4Protocol,
};
