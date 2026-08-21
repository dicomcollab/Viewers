import {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality2x2Protocol,
  allModality2x4Protocol,
} from './allModalityProtocols';

/**
 * Registers hanging protocols for the application.
 * 1×1 is the default for all modalities. 1×2 / 2×2 auto-apply only for ultrasound
 * (see protocolMatchingRules on those protocols). 2×4 is manual selection.
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
      name: allModality2x2Protocol.id,
      protocol: allModality2x2Protocol,
    },
    {
      name: allModality2x4Protocol.id,
      protocol: allModality2x4Protocol,
    },
  ];
}

export {
  allModality1x1Protocol,
  allModality1x2Protocol,
  allModality2x2Protocol,
  allModality2x4Protocol,
};
