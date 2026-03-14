"use client"

import * as ContextMenuPrimitive from "@radix-ui/react-context-menu"

import { cn } from "@/lib/utils"

function ContextMenu({
  ...props
}: ContextMenuPrimitive.ContextMenuProps) {
  return <ContextMenuPrimitive.Root {...props} />
}

function ContextMenuTrigger({
  ...props
}: ContextMenuPrimitive.ContextMenuTriggerProps) {
  return <ContextMenuPrimitive.Trigger {...props} />
}

function ContextMenuContent({
  className,
  ...props
}: ContextMenuPrimitive.ContextMenuContentProps) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Content
        className={cn(
          "z-50 min-w-[180px] overflow-hidden rounded-md border border-border/50 bg-background/95 p-1 text-sm text-foreground shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/75",
          "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          className
        )}
        {...props}
      />
    </ContextMenuPrimitive.Portal>
  )
}

function ContextMenuItem({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.ContextMenuItemProps & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.Item
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 outline-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "data-[highlighted]:bg-muted data-[highlighted]:text-foreground",
        inset && "pl-8",
        className
      )}
      {...props}
    />
  )
}

function ContextMenuSeparator({
  className,
  ...props
}: ContextMenuPrimitive.ContextMenuSeparatorProps) {
  return (
    <ContextMenuPrimitive.Separator
      className={cn("my-1 h-px bg-border/60", className)}
      {...props}
    />
  )
}

function ContextMenuLabel({
  className,
  inset,
  ...props
}: ContextMenuPrimitive.ContextMenuLabelProps & { inset?: boolean }) {
  return (
    <ContextMenuPrimitive.Label
      className={cn(
        "px-2 py-1.5 text-xs font-medium text-muted-foreground",
        inset && "pl-8",
        className
      )}
      {...props}
    />
  )
}

export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
}
