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

  if (!res.ok) {
    throw new Error("Unable to configure DIP!");
  }

  const data = await res.json();
  return data.data;
}

export { getDIP }