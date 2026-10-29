// A pre-extracted sample Journey so the demo works with no key and no mic.
// Loading it runs the same embedding + ThoughtSense scoring as live input.
// It shows every feature: a side path (sidePath / after), a Footstep holding three events,
// a Crawl, a Jump, a repeat, a trait break, an alias, and every kind of link.

window.KAHYO_SAMPLE = {
  title: 'The Salt Road',
  plannedLength: 18,
  characters: [
    {
      name: 'Meera',
      physical: ['Sun-darkened hands cracked from salt', 'Thin, wiry frame'],
      traits: [
        {
          text: 'Never lies to her brother Arjun',
        },
      ],
      strictness: 0.9,
    },
    {
      name: 'Arjun',
      physical: ['Tall, with a limp from an old injury'],
      traits: [
        {
          text: 'Afraid of the open sea',
        },
      ],
      strictness: 0.6,
    },
    {
      name: 'Collector Hale',
      physical: ['Heavy-set, red-faced in the heat', 'Always in a starched white collar'],
      traits: [
        {
          text: 'Values order over people',
        },
      ],
      strictness: 0.6,
      aliases: ['the Collector'],
    },
  ],
  thoughts: [
    {
      transcript:
        'So it opens in 1930, a salt village on the Gujarat coast. Meera is a salt worker, and the British have taxed salt so heavily that her family cannot afford what they make with their own hands.',
      footsteps: [
        {
          event: 'Meera works the salt pans while the British salt tax crushes her village',
          subjects: ['Meera'],
          context: 'Coastal Gujarat salt village, 1930, under the colonial salt tax',
          intensity: 0.5,
          promises: ['The tax will push the village to breaking point'],
          environment: ['Making or selling salt without paying the tax is illegal'],
          seeds: [],
        },
      ],
    },
    {
      transcript:
        'Her brother Arjun comes back from Ahmedabad with news that Gandhi is marching to Dandi to make salt in defiance of the law. Meera decides the village should join the march.',
      footsteps: [
        {
          event: 'Arjun returns with news that Gandhi is marching to Dandi to break the salt law',
          subjects: ['Arjun', 'Meera'],
          context: 'Arjun arrives from Ahmedabad at dusk',
          intensity: 0.7,
          promises: ['The march will reach the coast'],
          environment: [],
          seeds: [
            {
              target: 'FS#001',
              type: 'cause',
            },
          ],
        },
        {
          event: 'Meera decides the salt village will join the march and defy the salt tax',
          subjects: ['Meera'],
          context: 'A village meeting under the banyan tree',
          intensity: 0.8,
          promises: ['The village will face the Collector'],
          environment: [],
          seeds: [
            {
              target: 'NEW1',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript:
        'Collector Hale hears of it and orders the salt pans guarded. He offers Meera a deal: give him the names of the organisers and her family keeps their land.',
      footsteps: [
        {
          event: 'Collector Hale orders soldiers to guard the salt pans against the marchers',
          subjects: ['Collector Hale'],
          context: 'District office, the night before the march arrives',
          intensity: 0.7,
          promises: ['Soldiers and marchers will meet at the salt pans'],
          environment: ['Soldiers guard the salt pans'],
          seeds: [
            {
              target: 'FS#003',
              type: 'cause',
            },
          ],
        },
        {
          event: 'Hale offers Meera her family land in exchange for the names of the march organisers',
          subjects: ['Collector Hale', 'Meera'],
          context: 'A private meeting at the district office',
          intensity: 0.8,
          promises: ['Meera must choose between her family and the march'],
          environment: [],
          seeds: [
            {
              target: 'NEW1',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript:
        'What if, just exploring, there is a whole chapter where Arjun was once a sailor on a merchant ship to Zanzibar and we follow his voyage across the ocean, storms, the spice markets, a lover in port.',
      footsteps: [
        {
          event: 'Arjun sails a merchant ship to Zanzibar through ocean storms, spice markets and a lover in port',
          subjects: ['Arjun'],
          context: 'Years earlier, aboard a dhow crossing the Indian Ocean to Zanzibar',
          intensity: 0.3,
          promises: [],
          environment: [],
          seeds: [],
        },
      ],
      sidePath: 'start',
    },
    {
      transcript: 'Arjun asks Meera if she met the Collector, and she tells him no, she never went.',
      footsteps: [
        {
          event: 'Meera lies to Arjun and says she never met Collector Hale',
          subjects: ['Meera', 'Arjun'],
          context: 'At home, late at night, by the lamp',
          intensity: 0.7,
          promises: ['Arjun will discover the lie'],
          environment: [],
          seeds: [
            {
              target: 'FS#005',
              type: 'character_arc',
            },
          ],
          violations: [
            {
              character: 'Meera',
              trait: 'Never lies to her brother Arjun',
              severity: 'hard',
              suggestion: 'Have Meera stay silent or deflect instead of lying, or mark this as the moment the trait breaks and show what it costs her.',
            },
          ],
        },
      ],
    },
    {
      transcript: "Arjun finds the Collector's seal on a letter in Meera's things and realises she went to Hale. He stops speaking to her.",
      footsteps: [
        {
          event: "Arjun finds Hale's sealed letter among Meera's things and learns she lied",
          subjects: ['Arjun', 'Meera'],
          context: 'Their hut, the next morning',
          intensity: 0.7,
          promises: ["Meera must win back Arjun's trust"],
          environment: [],
          seeds: [
            {
              target: 'FS#007',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript: 'Meanwhile the march gets closer. Hale arrests the two village elders who organised it, hoping the rest will give up.',
      footsteps: [
        {
          event: 'Hale arrests the two village elders who organised the march',
          subjects: ['Collector Hale'],
          context: 'Soldiers come at night with lanterns',
          intensity: 0.8,
          promises: ['The village must decide whether to carry on without its leaders'],
          environment: [],
          seeds: [
            {
              target: 'FS#004',
              type: 'cause',
            },
          ],
        },
        {
          event: 'Meera confesses the deal to Arjun and asks him to help free the elders',
          subjects: ['Meera', 'Arjun'],
          context: 'On the shore, at low tide',
          intensity: 0.8,
          promises: [],
          environment: [],
          seeds: [
            {
              target: 'NEW1',
              type: 'cause',
            },
            {
              target: 'FS#008',
              type: 'character_arc',
            },
          ],
        },
      ],
    },
    {
      transcript: 'Arjun, who is terrified of the sea, takes a boat across the creek at night to warn the marchers that soldiers are waiting.',
      footsteps: [
        {
          event: 'Arjun crosses the creek by boat at night, despite his fear of the sea, to warn the marchers',
          subjects: ['Arjun'],
          context: 'A moonless night on the tidal creek',
          intensity: 0.8,
          promises: ['The marchers will come prepared'],
          environment: [],
          seeds: [
            {
              target: 'FS#010',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript: 'The women of the village gather salt in secret before dawn, filling clay pots to carry to the march.',
      footsteps: [
        {
          event: 'The village women gather salt in secret before dawn to carry to the march',
          subjects: ['Meera'],
          context: 'The salt pans in the dark before dawn',
          intensity: 0.7,
          promises: [],
          environment: [],
          seeds: [
            {
              target: 'FS#003',
              type: 'casual',
            },
          ],
        },
        {
          event: 'The march arrives at the village and thousands gather on the shore',
          subjects: ['Meera', 'Arjun'],
          context: 'Morning, drums and singing on the coast road',
          intensity: 0.9,
          promises: [],
          environment: [],
          seeds: [
            {
              target: 'FS#011',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript:
        'Then the ending: the march reaches the coast, Meera refuses Hale and leads the village onto the salt pans to make salt in front of the soldiers.',
      footsteps: [
        {
          event: 'Meera refuses Hale and leads the village onto the guarded salt pans to make salt in defiance',
          subjects: ['Meera', 'Collector Hale'],
          context: 'The salt pans at dawn as the march reaches the coast',
          intensity: 1,
          promises: [],
          environment: [],
          seeds: [
            {
              target: 'FS#005',
              type: 'cause',
            },
            {
              target: 'FS#004',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript: 'After it is over, Hale is recalled, the elders are freed, and Meera and Arjun stand on the pans as the first free salt dries.',
      footsteps: [
        {
          event: 'Hale is recalled, the elders are freed, and Meera and Arjun watch the first free salt dry',
          subjects: ['Meera', 'Arjun', 'Collector Hale'],
          context: 'Weeks later, the salt pans at sunset',
          intensity: 0.6,
          promises: [],
          environment: [],
          seeds: [
            {
              target: 'FS#014',
              type: 'cause',
            },
          ],
        },
      ],
    },
    {
      transcript: 'What if Arjun jumps ship in Zanzibar and joins a spice caravan heading inland?',
      after: 'FS#006',
      footsteps: [
        {
          subjects: ['Arjun'],
          context: 'Zanzibar harbour',
          intensity: 0.5,
          promises: [],
          environment: ['Zanzibar spice markets'],
          seeds: [
            {
              target: 'FS#006',
              type: 'cause',
            },
          ],
          event: 'Arjun jumps ship in Zanzibar and joins a spice caravan heading inland',
        },
      ],
    },
    {
      transcript: 'And then the caravan crosses the desert and Arjun is crowned a desert prince with a palace of glass.',
      after: 'FS#016',
      footsteps: [
        {
          subjects: ['Arjun'],
          context: '',
          intensity: 0.6,
          promises: [],
          environment: ['A desert kingdom'],
          seeds: [
            {
              target: 'FS#016',
              type: 'cause',
            },
          ],
          event: 'The caravan crosses the desert and Arjun is crowned a desert prince with a palace of glass',
        },
      ],
    },
    {
      transcript:
        'Before the soldiers come, the village gets ready. The women hide salt in the folds of their saris. The children keep watch from the palm trees.',
      after: 'FS#003',
      footsteps: [
        {
          subjects: ['Meera'],
          context: 'The days before the march',
          intensity: 0.5,
          promises: [],
          environment: ['The palm grove above the salt pans'],
          seeds: [
            {
              target: 'FS#003',
              type: 'cause',
            },
          ],
          events_count: 3,
          event:
            'The village gets ready before the soldiers come: the women hide salt in the folds of their saris and the children keep watch from the palm trees',
        },
      ],
    },
    {
      transcript: 'Arjun waits.',
      after: 'FS#009',
      footsteps: [
        {
          subjects: ['Arjun'],
          context: '',
          intensity: 0.1,
          promises: [],
          environment: [],
          seeds: [],
          event: 'Arjun waits',
        },
      ],
    },
    {
      transcript:
        "At the same moment the Collector telegraphs Bombay for more troops, the elders start a hunger strike in the jail, the newspapers in Ahmedabad print Meera's name, Arjun's old fear of the sea comes back as a fever, and the monsoon arrives early and floods half the salt pans.",
      after: 'FS#012',
      footsteps: [
        {
          subjects: ['Collector Hale', 'Meera', 'Arjun'],
          context: 'The week before the march arrives',
          intensity: 0.9,
          promises: ['The troops will arrive in time', "The strike will force the Collector's hand", 'The flood will ruin the salt harvest'],
          environment: ["Hale's district office", 'The village jail', 'The flooded salt pans'],
          seeds: [
            {
              target: 'FS#009',
              type: 'cause',
            },
            {
              target: 'FS#010',
              type: 'character_arc',
            },
          ],
          event:
            "Hale telegraphs Bombay for more troops, the jailed elders begin a hunger strike, the Ahmedabad newspapers print Meera's name, Arjun falls ill with fever, and the early monsoon floods half the salt pans",
        },
      ],
    },
    {
      transcript: 'The march arrives at the village and thousands gather on the shore, I think I said that already.',
      after: 'FS#013',
      footsteps: [
        {
          subjects: ['Meera', 'Arjun'],
          context: 'Morning, as the marchers reach the coast',
          intensity: 0.6,
          promises: [],
          environment: ['The shore below the salt pans'],
          seeds: [],
          event: 'The march arrives at the village and thousands gather on the shore',
        },
      ],
    },
  ],
};
