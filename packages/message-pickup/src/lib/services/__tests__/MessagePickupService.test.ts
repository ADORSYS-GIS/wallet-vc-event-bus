import { ServiceResponseStatus } from '@adorsys-gis/status-service';
import nock from 'nock';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { MessagePickupService } from '../MessagePickupService';
import {
  eventBus,
  waitForEvent,
  aliceDidTest,
  mediatorDidTest,
  responseFromStatusRequest,
  responseFromDeliveryRequest,
  secretsTest,
} from './helpers';
import { MessagePickupEvent } from '../../events';

describe('MessagePickupService', () => {
  const secretPinNumber = 1234;

  const messagePickupService = new MessagePickupService(
    eventBus,
    secretPinNumber,
  );

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
    vi.restoreAllMocks(); // Clear mock calls and instances
  });

  test('should process status request successfully', async () => {
    /// Prepare

    // Mock the method directly on the messagePickup instance
    const mockRetrievalOfSecrets = vi
      .spyOn(
        (messagePickupService as any)['messagePickup'],
        'retrieveSenderDidSecrets',
      )
      .mockResolvedValue(secretsTest);

    // Mock the response for processStatusRequest
    // Here message_count = 2
    nock('https://mediator.socious.io')
      .post(/.*/)
      .once()
      .reply(200, responseFromStatusRequest)
      .post(/.*/)
      .once()
      .reply(200, responseFromDeliveryRequest); // First request

    /// Act
    const channel = waitForEvent(MessagePickupEvent.MessagePickup);

    await messagePickupService.ReceiveMessages(mediatorDidTest, aliceDidTest);
    const eventData = await channel;

    const expectedResponse = {
      status: ServiceResponseStatus.Success,
      payload: 'Messages retrieved and stored successfully',
    };
    /// Assert
    expect(eventData).toEqual(expectedResponse);
    expect(mockRetrievalOfSecrets).toHaveBeenCalledTimes(2);
  });

  test('should fail because there is no mock of private keys', async () => {
    // Mock the response for processStatusRequest
    nock('https://mediator.socious.io')
      .post(/.*/)
      .once()
      .reply(404, 'not found');

    /// Act
    const channel = waitForEvent(MessagePickupEvent.MessagePickup);

    await messagePickupService.ReceiveMessages(mediatorDidTest, aliceDidTest);
    const eventData = await channel;

    /// Assert
    // Type assertion to a known shape
    const actual = eventData as {
      status: ServiceResponseStatus;
      payload: unknown;
    };

    // Check status
    expect(actual.status).toEqual(ServiceResponseStatus.Error);

    // Now check that payload is an Error and compare its string representation
    if (actual.payload instanceof Error) {
      expect(actual.payload.toString()).toEqual(
        'Error: Inexistent private keys for senderDid',
      );
    }
  });

  test('should fail because mediator is down', async () => {
    /// Prepare

    // Mock the method directly on the messagePickup instance
    const mockSomeMethod = vi
      .spyOn(
        (messagePickupService as any)['messagePickup'],
        'retrieveSenderDidSecrets',
      )
      .mockResolvedValue(secretsTest);

    // Mock the response for processStatusRequest
    nock('https://mediator.socious.io')
      .post(/.*/)
      .once()
      .reply(404, 'not found'); // First request

    /// Act
    const channel = waitForEvent(MessagePickupEvent.MessagePickup);

    await messagePickupService.ReceiveMessages(mediatorDidTest, aliceDidTest);
    const eventData = await channel;
    console.log('eventData: ', eventData);

    /// Assert
    // Type assertion to a known shape
    const actual = eventData as {
      status: ServiceResponseStatus;
      payload: unknown;
    };

    // Check status
    expect(actual.status).toEqual(ServiceResponseStatus.Error);

    // Now check that payload is an Error and compare its string representation
    if (actual.payload instanceof Error) {
      expect(actual.payload.toString()).toEqual(
        'Error: Failed to send message: Not Found - not found',
      );
    }
  });
});
