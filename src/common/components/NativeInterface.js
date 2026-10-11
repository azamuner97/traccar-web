import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { useDispatch, useSelector } from 'react-redux';
import { useAsyncTask } from '../../reactHelper';
import { sessionActions } from '../../store';
import fetchOrThrow from '../util/fetchOrThrow';
import { addNotificationToken } from '../util/notificationTokens';

export const nativeEnvironment =
  window.appInterface || (window.webkit && window.webkit.messageHandlers.appInterface);

export const nativePostMessage = (message) => {
  if (window.webkit && window.webkit.messageHandlers.appInterface) {
    window.webkit.messageHandlers.appInterface.postMessage(message);
  } else if (window.appInterface) {
    window.appInterface.postMessage(message);
  }
};

export const generateLoginToken = async () => {
  if (nativeEnvironment) {
    let token = '';
    try {
      const expiration = dayjs().add(6, 'months').toISOString();
      const response = await fetch('/api/session/token', {
        method: 'POST',
        body: new URLSearchParams(`expiration=${expiration}`),
      });
      if (response.ok) {
        token = await response.text();
      }
    } catch {
      token = '';
    }
    nativePostMessage(`login|${token}`);
  }
};

export const handleLoginTokenListeners = new Set();
window.handleLoginToken = (token) => {
  handleLoginTokenListeners.forEach((listener) => listener(token));
};

const updateNotificationTokenListeners = new Set();
window.updateNotificationToken = (token) => {
  updateNotificationTokenListeners.forEach((listener) => listener(token));
};

export const handleNativeNotificationListeners = new Set();
window.handleNativeNotification = (message) => {
  handleNativeNotificationListeners.forEach((listener) => listener(message));
};

const NativeInterface = () => {
  const dispatch = useDispatch();

  const user = useSelector((state) => state.session.user);
  const [notificationToken, setNotificationToken] = useState(null);

  useEffect(() => {
    const listener = (token) => setNotificationToken(token);
    updateNotificationTokenListeners.add(listener);
    return () => updateNotificationTokenListeners.delete(listener);
  }, [setNotificationToken]);

  useAsyncTask(
    async ({ signal }) => {
      if (user && notificationToken) {
        try {
          window.localStorage.setItem('notificationToken', notificationToken);
        } catch {
          // Storage restrictions must not prevent server-side token registration.
        }
        // Do not overwrite tokens or other attributes using an old Redux snapshot.
        const currentResponse = await fetchOrThrow('/api/session', { signal });
        const currentUser = await currentResponse.json();
        if (signal.aborted || currentUser.id !== user.id) return;
        const tokens = addNotificationToken(
          currentUser.attributes?.notificationTokens,
          notificationToken,
        );
        if (tokens !== currentUser.attributes?.notificationTokens) {
          const updatedUser = {
            ...currentUser,
            attributes: {
              ...currentUser.attributes,
              notificationTokens: tokens,
            },
          };

          const response = await fetchOrThrow(`/api/users/${user.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedUser),
            signal,
          });
          const registeredUser = await response.json();
          if (signal.aborted) return;
          dispatch(sessionActions.updateUser(registeredUser));
        }
        setNotificationToken(null);
      }
    },
    [user, notificationToken, setNotificationToken, dispatch],
  );

  return null;
};

export default NativeInterface;
