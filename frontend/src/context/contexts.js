import { createContext } from 'react';

// Objetos de contexto separados de los providers (.jsx) y de los hooks:
// react-refresh exige que un archivo de componentes exporte solo componentes
// para que el Fast Refresh funcione, así que el contexto vive aquí.
export const AuthContext = createContext(null);
export const ThemeContext = createContext(null);
export const ToastContext = createContext(null);
