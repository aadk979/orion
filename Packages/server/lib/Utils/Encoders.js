function base64Encode(input) {
    return Buffer.from(input, "utf-8").toString("base64");
  }
  
  function base64Decode(encoded) {
    return Buffer.from(encoded, "base64").toString("utf-8");
  }
  
  module.exports = { base64Encode, base64Decode };
  