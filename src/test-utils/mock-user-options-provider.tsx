import React, { PropsWithChildren, useState } from "react";
import { UserOptionsContext } from "../contexts/user-options-context";
import { kDefaultOptions } from "../constants";
import { IUserOptions } from "../types";

const defaultMockOptions: IUserOptions = {
  ...kDefaultOptions,
};

interface MockUserOptionsProviderProps {
  initialOptions?: Partial<IUserOptions>;
}

export const MockUserOptionsProvider: React.FC<PropsWithChildren<MockUserOptionsProviderProps>> = ({
  children,
  initialOptions = {},
}) => {
  const [options, setOptions] = useState<IUserOptions>({
    ...defaultMockOptions,
    ...initialOptions,
  });

  return (
    <UserOptionsContext.Provider value={{ options, setOptions }}>
      {children}
    </UserOptionsContext.Provider>
  );
};
