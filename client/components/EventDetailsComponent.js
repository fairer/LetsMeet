import React from 'react';
import update from 'react-addons-update';
import autobind from 'autobind-decorator';
import { browserHistory } from 'react-router';
import DayPicker, { DateUtils } from 'react-day-picker';
import cssModules from 'react-css-modules';
import fetch from 'isomorphic-fetch';
import _ from 'lodash';
import moment from 'moment';
import nprogress from 'nprogress';
import Notification from '../components/vendor/react-notification';

import AvailabilityGrid from './AvailabilityGrid';

import { checkStatus, parseJSON } from '../util/fetch.util';
import { getCurrentUser } from '../util/auth';

import styles from '../styles/event-card.css';
import 'react-day-picker/lib/style.css';

class EventDetailsComponent extends React.Component {
  constructor(props) {
    super(props);
    const eventParticipantsIds = props.event.participants.map(participant => participant._id);
    const { event } = props;

    let ranges;
    let dates;

    if (event.weekDays) {
      dates = event.dates;
    } else {
      delete event.weekDays;

      ranges = event.dates.map(({ fromDate, toDate }) => ({
        from: new Date(fromDate),
        to: new Date(toDate),
      }));

      dates = event.dates.map(({ fromDate, toDate }) => ({
        fromDate: new Date(fromDate),
        toDate: new Date(toDate),
      }));
    }

    this.state = {
      event,
      ranges,
      dates,
      days: event.weekDays,
      user: {},
      eventParticipantsIds,
      participants: event.participants,
      showHeatmap: false,
      myAvailability: [],
      notificationIsActive: false,
      notificationMessage: '',
      notificationTitle: '',
      showEmail: false,
    };
  }

  async componentWillMount() {
    const user = await getCurrentUser();
    if (user) {
      let showHeatmap = false;
      let myAvailability = [];

      const me = this.state.participants.find(participant =>
        participant._id === user._id
      );

      if (me && me.availability) {
        showHeatmap = true;
        myAvailability = me.availability;
      }

      this.setState({ user, showHeatmap, myAvailability });
    }
    this.generateBestDatesAndTimes(this.state.event);
  }

  componentDidMount() {
    setTimeout(() => {
      $('.alt').each((i, el) => {
        $(el).parents('.card').find('#best')
          .remove();
      });
    }, 100);

    $('.notification-bar-action').on('click', () => {
      this.setState({ notificationIsActive: false, showEmail: false });
    });
  }

  selectElementContents(el) {
    let range;
    if (window.getSelection && document.createRange) {
      range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (document.body && document.body.createTextRange) {
      range = document.body.createTextRange();
      range.moveToElementText(el);
      range.select();
    }
  }

  @autobind
  async joinEvent() {
    const { name, avatar, _id } = this.state.user;

    const participant = { name, avatar, _id };

    const event = update(this.state.event, {
      participants: { $push: [participant] },
    });

    const eventParticipantsIds = update(this.state.eventParticipantsIds, {
      $push: [this.state.user._id],
    });

    const sentData = JSON.stringify(event);

    nprogress.configure({ showSpinner: false });
    nprogress.start();
    const response = await fetch(`/api/events/${event._id}`, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      method: 'PUT',
      body: sentData,
    });

    try {
      checkStatus(response);
    } catch (err) {
      console.log(err);
      this.setState({
        notificationIsActive: true,
        notificationMessage: 'Failed to join event. Please try again later.',
        notificationTitle: 'Error!',
        showEmail: false,
      });
      return;
    } finally {
      nprogress.done();
    }

    this.setState({ event, eventParticipantsIds });
  }

  @autobind
  showAvailability(ev) {
    document.getElementById('availability-grid').className = '';
    ev.target.className += ' hide';
  }

  @autobind
  editAvail() {
    this.setState({ showHeatmap: false }, () => {
      document.getElementById('enterAvailButton').click();
    });
  }

  @autobind
  async submitAvailability(myAvailability) {
    nprogress.configure({ showSpinner: false });
    nprogress.start();
    const response = await fetch(`/api/events/${this.state.event._id}`, {
      credentials: 'same-origin',
    });
    let event;

    try {
      checkStatus(response);
      event = await parseJSON(response);
    } catch (err) {
      console.log(err);
      this.setState({
        notificationIsActive: true,
        notificationMessage: 'Failed to update availability. Please try again later.',
        notificationTitle: 'Error!',
        showEmail: false,
      });
      return;
    } finally {
      nprogress.done();
    }

    this.setState({
      notificationIsActive: true,
      notificationMessage: 'Saved availability successfully.',
      notificationTitle: 'Success!',
      showEmail: false,
    });

    this.generateBestDatesAndTimes(event);
    this.setState({ showHeatmap: true, myAvailability, event, participants: event.participants });
  }

  @autobind
  async deleteEvent() {
    nprogress.configure({ showSpinner: false });
    nprogress.start();
    const response = await fetch(`/api/events/${this.state.event._id}`, {
      credentials: 'same-origin', method: 'DELETE',
    });

    try {
      checkStatus(response);
    } catch (err) {
      console.log(err);
      this.setState({
        notificationIsActive: true,
        notificationMessage: 'Failed to delete event. Please try again later.',
        notificationTitle: 'Error!',
        showEmail: false,
      });
      return;
    } finally {
      nprogress.done();
    }

    this.setState({
      notificationIsActive: true,
      notificationMessage: 'Event successfully deleted!',
      notificationTitle: '',
      showEmail: false,
    });

    browserHistory.push('/dashboard');
  }

  generateBestDatesAndTimes(event) {
    const availability = [];
    const overlaps = [];
    const displayTimes = {};
    const formatStr = this.state.days ? 'dddd' : 'DD MMM';

    event.participants.forEach(user => {
      if (user.availability !== undefined) availability.push(user.availability);
    });

    if (availability.length <= 1) return;

    for (let i = 0; i < availability[0].length; i++) {
      const current = availability[0][i];
      let count = 0;
      for (let j = 0; j < availability.length; j++) {
        for (let k = 0; k < availability[j].length; k++) {
          if (availability[j][k][0] === current[0]) {
            count++;
          }
        }
      }
      if (count === availability.length) overlaps.push(current);
    }


    if (overlaps.length === 0) {
      this.setState({ displayTimes });
      return;
    }

    let index = 0;
    for (let i = 0; i < overlaps.length; i++) {
      if (overlaps[i + 1] !== undefined && overlaps[i][1] !== overlaps[i + 1][0]) {
        if (displayTimes[moment(overlaps[index][0]).format(formatStr)] !== undefined) {
          displayTimes[moment(overlaps[index][0]).format(formatStr)].hours.push(
            `${moment(overlaps[index][0]).format('h:mm a')} to ${moment(overlaps[i][1]).format('h:mm a')}`
          );
        } else {
          displayTimes[moment(overlaps[index][0]).format(formatStr)] = {
            hours: [`${moment(overlaps[index][0]).format('h:mm a')} to ${moment(overlaps[i][1]).format('h:mm a')}`],
          };
        }
        index = i + 1;
      } else if (overlaps[i + 1] === undefined) {
        if (displayTimes[moment(overlaps[index][0]).format(formatStr)] !== undefined) {
          displayTimes[moment(overlaps[index][0]).format(formatStr)].hours.push(
            `${moment(overlaps[index][0]).format('h:mm a')} to ${moment(overlaps[i][1]).format('h:mm a')}`
          );
        } else {
          displayTimes[moment(overlaps[index][0]).format(formatStr)] = {
            hours: [`${moment(overlaps[index][0]).format('h:mm a')} to ${moment(overlaps[i][1]).format('h:mm a')}`],
          };
        }
      }
    }

    this.setState({ displayTimes });
  }

  @autobind
  shareEvent() {
    this.setState({
      notificationIsActive: true,
      notificationMessage: window.location.href,
      notificationTitle: 'Event URL:',
      showEmail: true,
    });
    setTimeout(() => {
      this.selectElementContents(document.getElementsByClassName('notification-bar-message')[0]);
    }, 100);
  }

  render() {
    let modifiers;

    const { event, user, showHeatmap, participants, myAvailability, eventParticipantsIds } = this.state;
    const availability = participants.map(participant => participant.availability);
    let isOwner;

    if (user !== undefined) {
      isOwner = event.owner === user._id;
    }

    // Determine the months to show in the datepicker via the maximum and minimum date in the time
    // ranges

    let maxDate;
    let minDate;

    if (this.state.ranges) {
      const dateInRanges = _.flatten(this.state.ranges.map(range => [range.from, range.to]));
      maxDate = new Date(Math.max.apply(null, dateInRanges));
      minDate = new Date(Math.min.apply(null, dateInRanges));

      modifiers = {
        selected: day =>
          DateUtils.isDayInRange(day, this.state) ||
          this.state.ranges.some(v => DateUtils.isDayInRange(day, v)),
      };
    }

    const bestTimes = this.state.displayTimes;
    let isBestTime;

    if (bestTimes !== undefined) {
      if (Object.keys(bestTimes).length > 0) isBestTime = true;
      else isBestTime = false;
    } else isBestTime = false;

    const notifActions = [{
      text: 'Dismiss',
      handleClick: () => { this.setState({ notificationIsActive: false }); },
    }];

    if (this.state.showEmail) {
      notifActions.push({
        text: 'Email Event',
        handleClick: () => { window.location.href = `mailto:?subject=Schedule ${event.name}&body=Hey there,%0D%0A%0D%0AUsing the following tool, please block your availability for ${event.name}:%0D%0A%0D%0A${window.location.href} %0D%0A%0D%0A All times will automatically be converted to your local timezone.`; },
      });
    }

    return (
      <div className="card meeting" styleName="event-details">
      {
        isOwner ?
          <button
            className="mdl-button mdl-js-button mdl-button--fab mdl-button--colored"
            styleName="delete-event"
            onClick={() => document.querySelector('#deleteEventModal').showModal()}
          ><i className="material-icons">delete</i></button> : null
      }
        <div className="card-content">
          <span styleName="card-title" className="card-title">{event.name}</span>
          <h6 id="best"><strong>All participants so far are available at:</strong></h6>
          <div className="row">
            <div className="col s12">
              {isBestTime ?
                Object.keys(bestTimes).map(date => (
                  <div>
                    <div styleName="bestTimeDate">
                      <i
                        className="material-icons"
                        styleName="material-icons"
                      >date_range</i>
                      {date}
                    </div>
                    <div styleName="bestTime">
                      <i
                        className="material-icons"
                        styleName="material-icons"
                      >alarm</i>
                      {bestTimes[date].hours.join(', ')}
                    </div>
                    <hr />
                  </div>
                )) : !event.weekDays ?
                  <DayPicker
                    className="alt"
                    initialMonth={minDate}
                    fromMonth={minDate}
                    toMonth={maxDate}
                    modifiers={modifiers}
                  /> :
                  Object.keys(event.weekDays).map((day, index) => {
                    let className = 'btn-flat alt';
                    if (!event.weekDays[day]) {
                      className += ' disabled';
                    }

                    return (
                      <a
                        key={index}
                        className={className}
                        onClick={this.handleWeekdaySelect}
                        style={{ cursor: 'default' }}
                      >{day}</a>
                    );
                  })
              }
            </div>
          </div>
          {showHeatmap ?
            <div id="heatmap">
              {event.weekDays ?
                <AvailabilityGrid
                  dates={this.state.dates}
                  availability={availability}
                  editAvail={this.editAvail}
                  participants={participants}
                  heatmap
                  weekDays
                /> :
                <AvailabilityGrid
                  dates={this.state.dates}
                  availability={availability}
                  editAvail={this.editAvail}
                  participants={participants}
                  heatmap
                />
              }
            </div> :
            <div id="grid" className="center">
              <div id="availability-grid" className="hide">
                {event.weekDays ?
                  <AvailabilityGrid
                    dates={this.state.dates}
                    user={this.state.user}
                    submitAvail={this.submitAvailability}
                    availability={availability}
                    myAvailability={myAvailability}
                    event={event}
                    weekDays
                  /> :
                  <AvailabilityGrid
                    dates={this.state.dates}
                    user={this.state.user}
                    availability={availability}
                    myAvailability={myAvailability}
                    submitAvail={this.submitAvailability}
                    event={event}
                  />
                }
              </div>
              {Object.keys(user).length > 0 ?
                eventParticipantsIds.indexOf(user._id) > -1 ?
                  <a
                    id="enterAvailButton"
                    className="waves-effect waves-light btn"
                    onClick={this.showAvailability}
                  >Enter my availability</a> :
                  <a
                    className="waves-effect waves-light btn"
                    onClick={this.joinEvent}
                  >Join Event</a> :
                <p>Login to enter your availability!</p>
              }
            </div>
          }
          <br />
          <div>
            <h6><strong>Participants</strong></h6>
            {event.participants.map((participant, index) => (
              <div className="participant" styleName="participant" key={index}>
                <img
                  className="circle"
                  styleName="participant-img"
                  src={participant.avatar}
                  alt="participant avatar"
                />
                {participant.name}
              </div>
            ))}
          </div>
        </div>
        <div styleName="action" className="card-action">
          <a onClick={this.shareEvent}>Share Event</a>
        </div>
        <Notification
          isActive={this.state.notificationIsActive}
          message={this.state.notificationMessage}
          actions={notifActions}
          title={this.state.notificationTitle}
          onDismiss={() => this.setState({ notificationIsActive: false })}
          dismissAfter={10000}
          activeClassName="notification-bar-is-active"
        />
        <dialog
          onClick={(ev) => ev.stopPropagation()}
          className="mdl-dialog"
          styleName="mdl-dialog"
          id="deleteEventModal"
        >
          <h6 styleName="modal-title" className="mdl-dialog__title">Are you sure you want to delete the event?</h6>
          <div className="mdl-dialog__actions">
            <button
              type="button"
              className="mdl-button close"
              onClick={() => document.querySelector('#deleteEventModal').close()}
            >Cancel</button>
            <button
              type="button"
              className="mdl-button"
              style={{ color: '#f44336' }}
              onClick={this.deleteEvent}
            >Yes</button>
          </div>
        </dialog>
      </div>
    );
  }
}

EventDetailsComponent.propTypes = {
  event: React.PropTypes.object,
};

export default cssModules(EventDetailsComponent, styles);
