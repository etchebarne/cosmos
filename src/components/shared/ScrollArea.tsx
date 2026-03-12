import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ComponentPropsWithoutRef } from "react";

type ScrollAreaProps = ComponentPropsWithoutRef<"div">;

export function ScrollArea({ children, ...props }: ScrollAreaProps) {
  return (
    <OverlayScrollbarsComponent
      options={{
        scrollbars: {
          autoHide: "scroll",
          autoHideDelay: 800,
          theme: "os-theme-custom",
        },
        overflow: {
          x: "hidden",
          y: "scroll",
        },
      }}
      {...props}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
