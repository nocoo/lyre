import { LoadingScreen as BasaltLoadingScreen } from "@nocoo/basalt/components/loading-screen";

export default function LoadingScreen() {
	return (
		<BasaltLoadingScreen
			label="Loading"
			mark={<img src="/logo-80.png" alt="" width={32} height={32} className="h-8 w-8" />}
		/>
	);
}
