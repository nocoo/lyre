import type { ReactNode } from "react";
import { Link } from "react-router";

export function AppLink({
	href,
	className,
	children,
}: {
	href: string;
	className?: string;
	children?: ReactNode;
}) {
	if (/^(https?:|mailto:|tel:)/i.test(href)) {
		return (
			<a href={href} className={className}>
				{children}
			</a>
		);
	}
	return (
		<Link to={href} className={className}>
			{children}
		</Link>
	);
}
