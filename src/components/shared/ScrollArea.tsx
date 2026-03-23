import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { OverlayScrollbarsComponentProps } from "overlayscrollbars-react";

export function ScrollArea({ children, ...props }: OverlayScrollbarsComponentProps) {
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
