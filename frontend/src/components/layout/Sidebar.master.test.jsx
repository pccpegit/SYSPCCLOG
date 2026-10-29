import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useAuth } from '../../context/AuthContext';

// SYSPCC-030 — «Master de RQ» en el menú de /rq, visible para todo rol que ve RQs.
vi.mock('../../context/AuthContext', () => ({ useAuth: vi.fn() }));

describe.each(['REQUESTER', 'PROJECT_RESIDENT', 'LOGISTICS_COORDINATOR', 'GENERAL_MANAGER'])('Sidebar (%s)', (role) => {
  it('ofrece «Master de RQ» hacia /rq/master', () => {
    useAuth.mockReturnValue({ primaryRole: role });
    render(<MemoryRouter><Sidebar isOpen onClose={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Master de RQ' })).toHaveAttribute('href', '/rq/master');
  });
});
