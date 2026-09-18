import { redirect } from 'next/navigation';

// The dashboard arrives in phase 4; until then the panel opens on the client list.
export default function StaffHomePage() {
  redirect('/panel/clientes');
}
