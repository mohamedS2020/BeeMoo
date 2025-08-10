import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ParticipantList } from '../js/components/ParticipantList.js';

const mockSocketClient = {
  on: vi.fn(),
  off: vi.fn(),
};

describe('ParticipantList', () => {
  let list;
  let container;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    list = new ParticipantList(mockSocketClient);
    list.attach(container);
  });

  afterEach(() => {
    list.destroy();
    container.remove();
  });

  it('renders empty state initially', () => {
    expect(container.querySelector('.participants-count').textContent).toBe('0');
    expect(container.querySelector('.participants-list').textContent).toContain('Waiting for participants');
  });

  it('sets participants and renders items', () => {
    list.setParticipants([
      { socketId: 'a', username: 'Alice', isHost: true, muted: false },
      { socketId: 'b', username: 'Bob', isHost: false, muted: true },
    ]);

    const items = container.querySelectorAll('.participant');
    expect(items.length).toBe(2);

    const count = container.querySelector('.participants-count').textContent;
    expect(count).toBe('2');

    expect(container.innerHTML).toContain('Alice');
    expect(container.innerHTML).toContain('HOST');
    expect(container.innerHTML).toContain('Bob');
    expect(container.innerHTML).toContain('🔇');
  });

  it('adds or updates participant', () => {
    list.addOrUpdateParticipant({ socketId: 'c', username: 'Charlie', muted: false });
    expect(container.querySelector('.participants-count').textContent).toBe('1');
    expect(container.innerHTML).toContain('Charlie');

    // Update mic status
    list.addOrUpdateParticipant({ socketId: 'c', muted: true });
    expect(container.innerHTML).toContain('🔇');
  });

  it('removes a participant', () => {
    list.setParticipants([{ socketId: 'x', username: 'Xenia' }]);
    expect(container.querySelector('.participants-count').textContent).toBe('1');

    list.removeParticipant({ socketId: 'x' });
    expect(container.querySelector('.participants-count').textContent).toBe('0');
  });

  it('binds and unbinds socket events once', () => {
    expect(mockSocketClient.on).toHaveBeenCalledWith('participant-joined', expect.any(Function));
    expect(mockSocketClient.on).toHaveBeenCalledWith('participant-left', expect.any(Function));
    expect(mockSocketClient.on).toHaveBeenCalledWith('participant-mic-updated', expect.any(Function));
    expect(mockSocketClient.on).toHaveBeenCalledWith('participant-disconnected', expect.any(Function));

    list.detach();

    expect(mockSocketClient.off).toHaveBeenCalledWith('participant-joined', expect.any(Function));
    expect(mockSocketClient.off).toHaveBeenCalledWith('participant-left', expect.any(Function));
    expect(mockSocketClient.off).toHaveBeenCalledWith('participant-mic-updated', expect.any(Function));
    expect(mockSocketClient.off).toHaveBeenCalledWith('participant-disconnected', expect.any(Function));
  });

  it('handles participant-joined payload with participants array', () => {
    const handler = mockSocketClient.on.mock.calls.find(c => c[0] === 'participant-joined')[1];
    handler({ participants: [{ socketId: 'a', username: 'Alice' }] });
    expect(container.querySelector('.participants-count').textContent).toBe('1');
  });

  it('handles participant-left payload with single participant', () => {
    list.setParticipants([{ socketId: 'a', username: 'Alice' }]);
    const handler = mockSocketClient.on.mock.calls.find(c => c[0] === 'participant-left')[1];
    handler({ participant: { socketId: 'a' } });
    expect(container.querySelector('.participants-count').textContent).toBe('0');
  });

  it('escapes HTML in usernames', () => {
    list.setParticipants([{ socketId: 'e', username: '<script>alert(1)</script>' }]);
    expect(container.innerHTML).not.toContain('<script>');
  });
});
