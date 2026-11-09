import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { Alert, AppBar, IconButton, Toolbar, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';
import BackIcon from '../common/components/BackIcon';
import GameStateCard from './GameStateCard';
import ParticipantGameView from './ParticipantGameView';
import { gameRole, holdsJokers } from './gameView';
import useGameTranslation from './useGameTranslation';

const useStyles = makeStyles()((theme) => ({
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  content: {
    flexGrow: 1,
    overflowY: 'auto',
  },
  column: {
    boxSizing: 'border-box',
    width: '100%',
    maxWidth: 720,
    margin: '0 auto',
    padding: theme.spacing(2),
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(2),
  },
}));

/** The member's own game view: status, jokers, breaks and requests (players and supporters). */
const GamePage = () => {
  const { classes } = useStyles();
  const navigate = useNavigate();
  const t = useGameTranslation();
  const user = useSelector((state) => state.session.user);
  const socket = useSelector((state) => state.session.socket);
  const game = useSelector((state) => state.game);
  const role = gameRole(user);

  return (
    <div className={classes.root}>
      <AppBar position="static" color="inherit" elevation={1}>
        <Toolbar>
          <IconButton edge="start" sx={{ mr: 2 }} onClick={() => navigate('/')}>
            <BackIcon />
          </IconButton>
          <Typography variant="h6">{t('gameTitle')}</Typography>
        </Toolbar>
      </AppBar>
      <div className={classes.content}>
        <div className={classes.column}>
          <GameStateCard game={game} socket={socket} showSpeedhunt={holdsJokers(role)} />
          {holdsJokers(role) && game.loaded && <ParticipantGameView game={game} userId={user.id} />}
          {role && !holdsJokers(role) && <Alert severity="info">{t('gameRoleNotYet')}</Alert>}
        </div>
      </div>
    </div>
  );
};

export default GamePage;
