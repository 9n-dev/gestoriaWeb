import 'next-auth';
import 'next-auth/jwt';

// The JWT is only a pointer to a UserSession row (ADR 0002).
declare module 'next-auth' {
  interface User {
    sessionId?: string;
  }
  interface Session {
    sessionId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionId?: string;
  }
}
