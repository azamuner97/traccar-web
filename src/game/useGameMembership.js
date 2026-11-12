import { shallowEqual, useSelector } from 'react-redux';
import { selectGameMembership } from './gameView';

/**
 * The signed-in member as /api/game-status names them, or null (administrators, accounts without membership,
 * and while the status is not known yet). Re-renders only when the membership itself changes.
 */
const useGameMembership = () => useSelector(selectGameMembership, shallowEqual);

export default useGameMembership;
