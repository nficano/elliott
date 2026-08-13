const ROUTE_NAME = /^[a-z\d][a-z\d-]*$/i;
const LABEL = /^[a-z\d][a-z\d-]*$/i;

export const routeName = (value: string): string => {
  if (!ROUTE_NAME.test(value)) throw new Error(`Invalid route name: ${value}`);
  return value.toLowerCase();
};

export const hostnameValue = (value: string): string => {
  const labels = value.split(".");
  const invalid = labels.some((label) =>
    !LABEL.test(label) || label.endsWith("-")
  );
  if (invalid) throw new Error(`Invalid hostname: ${value}`);
  return value.toLowerCase();
};

export const serviceTarget = (value: string): string => {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Service URL must be HTTP or HTTPS");
  }
  return url.href;
};
