import { CloneMethodArgs } from '@adorsys-gis/cloning-decorator';
import EventEmitter from 'eventemitter3';
import { MessagePickupService as _MessagePickupService } from './MessagePickupService';

// This decorator function will deep clone every argument passed to any method of the class
// it decorates, except when it is an instance of `EventEmitter` to preserve the same event
// bus instance between layers.
const decorate = CloneMethodArgs({ exclude: [EventEmitter] });

export const MessagePickupService = decorate(_MessagePickupService);
