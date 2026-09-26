import { useTheme } from '@mui/material/styles';
import { makeStyles } from 'tss-react/mui';
import { getStatusColor } from '../../common/util/formatter';
import { roleBackgrounds } from '../../map/core/preloadImages';

const useStyles = makeStyles()({
  root: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '100%',
  },
  background: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  number: {
    position: 'relative',
    fontWeight: 700,
    lineHeight: 1,
  },
});

const RoleBadge = ({ marker, status }) => {
  const { classes } = useStyles();
  const theme = useTheme();
  const statusColor = getStatusColor(status);

  return (
    <span className={classes.root} role="img" aria-label={`${marker.role} ${marker.number}`}>
      <img className={classes.background} src={roleBackgrounds[marker.role]} alt="" />
      <span
        className={classes.number}
        style={{
          color: theme.palette[statusColor]?.main || theme.palette.neutral.main,
          fontSize: marker.textSize,
        }}
      >
        {marker.number}
      </span>
    </span>
  );
};

export default RoleBadge;
