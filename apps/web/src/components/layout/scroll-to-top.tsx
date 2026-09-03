import { Button } from "@nocoo/basalt";
import { Rocket } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScrollToTop({
	visible,
	onClick,
}: {
	visible: boolean;
	onClick: () => void;
}) {
	return (
		<Button
			type="button"
			size="icon"
			onClick={onClick}
			aria-label="Scroll to top"
			className={cn(
				"absolute right-6 bottom-6 z-30 rounded-full shadow-lg transition-all duration-300 ease-out",
				"hover:scale-110 active:scale-95",
				visible ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0",
			)}
		>
			<Rocket className="h-4 w-4" strokeWidth={1.5} />
		</Button>
	);
}
