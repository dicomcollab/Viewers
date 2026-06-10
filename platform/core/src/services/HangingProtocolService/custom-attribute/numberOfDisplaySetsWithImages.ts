export default (study, extraData) => {
  return extraData?.displaySets?.filter(ds => ds.numImageFrames > 0)?.length;
};
