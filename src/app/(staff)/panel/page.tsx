import { redirect } from 'next/navigation';

// The dashboard arrives in phase 4; until then the panel opens on the document inbox.
export default function StaffHomePage() {
  redirect('/panel/bandeja');
}
