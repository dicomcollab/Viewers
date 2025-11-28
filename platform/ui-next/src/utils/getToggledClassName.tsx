const getToggledClassName = isToggled => {
  return isToggled
    ? 'text-white'
    : '!text-common-bright hover:!bg-primary-dark hover:text-primary-light';
};

export { getToggledClassName };
