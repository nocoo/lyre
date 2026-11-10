import { createContext, useContext } from "react";

const MobileNavCloseContext = createContext<(() => void) | undefined>(undefined);

export function MobileNavCloseProvider({
	value,
	children,
}: {
	value: (() => void) | undefined;
	children: React.ReactNode;
}) {
	return <MobileNavCloseContext.Provider value={value}>{children}</MobileNavCloseContext.Provider>;
}

export function useMobileNavClose() {
	return useContext(MobileNavCloseContext);
}
