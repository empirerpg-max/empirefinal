import { createFileRoute, Navigate } from '@tanstack/react-router';

export const Route = createFileRoute('/catalogo/')({ component: CatalogoRedirect });

export default function CatalogoRedirect() {
  return <Navigate to="/" replace />;
}
