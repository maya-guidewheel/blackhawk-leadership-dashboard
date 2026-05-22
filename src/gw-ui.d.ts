declare module '@safigen/fd-gw-ui/page-header' {
  import type { ComponentType, ReactNode } from 'react';
  export const PageHeader: ComponentType<{
    title: ReactNode;
    subtitle?: ReactNode;
    timezone?: ReactNode;
    plantSelector?: ReactNode;
    primaryAction?: ReactNode;
    withSeparator?: boolean;
    className?: string;
  }>;
}
