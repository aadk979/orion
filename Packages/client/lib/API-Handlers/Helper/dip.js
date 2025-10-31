async function getDIP({ Api, getAuthHeader, nameSpace }) {
  const { authHead } = await getAuthHeader(null, "NO_BEARER");

  const res = await Api.fetch(
    `/${nameSpace}/api/v1/action/configure-dip`,
    "POST",
    authHead,
    null,
    null,
    null
  );
  const data = await res.json();

  if (data.error && data.errorData.errorCode !== "DIP-DISABLED") {
    throw new Error("Unable to configure DIP!");
  }

  return data.error ? data : data.data;
}

export { getDIP }