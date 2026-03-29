const notImplemented = (name) => async () => {
  throw new Error(`Not implemented: ${name}`);
};

export const createServiceAccount = notImplemented('createServiceAccount');
export const deleteServiceAccount = notImplemented('deleteServiceAccount');
