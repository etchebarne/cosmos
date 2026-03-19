import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import type { ElementType } from "react";
import type { OverlayScrollbarsComponentProps } from "overlayscrollbars-react";

export function ScrollArea<T extends ElementType = "div">({
  children,
  ...props
}: OverlayScrollbarsComponentProps<T>) {
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
      {...(props as any)}
    >
      {children}
    </OverlayScrollbarsComponent>
  );
}
